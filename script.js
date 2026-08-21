const id = () => crypto.randomUUID();
const { url: supabaseUrl, anonKey: supabaseAnonKey } = window.SUPABASE_CONFIG || {};
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseAnonKey);
const money = value => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const displayDate = value => value ? value.split('-').reverse().join('/') : '';
const dateOnly = value => {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date(NaN);
};
const validDate = value => value && !Number.isNaN(dateOnly(value).getTime());
const inputDate = value => { const date = dateOnly(value); return validDate(value) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : ''; };
const mondayOf = value => { const date = dateOnly(value); if (!validDate(value)) return ''; date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return inputDate(date); };
const sundayOf = value => { const monday = dateOnly(value); if (!validDate(value)) return ''; monday.setDate(monday.getDate() + 6); return inputDate(monday); };
const inRange = (date, from, to) => validDate(from) && validDate(to) && dateOnly(date) >= dateOnly(from) && dateOnly(date) <= dateOnly(to);
const isDateInWeek = (value, weekStart) => inRange(value, weekStart, new Date(dateOnly(weekStart).getTime() + 6 * 86400000));
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
let lastWageAuditSignature = '';

function statementPeriod(text) {
  const numeric = text.match(/from\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (numeric) return { start: dateOnly(`${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`), end: dateOnly(`${numeric[6]}-${numeric[5].padStart(2, '0')}-${numeric[4].padStart(2, '0')}`) };
  const listing = text.match(/transactions\s*\((\d{1,2})-([A-Za-z]{3})-(\d{4})\s+to\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})\)/i);
  if (!listing) throw new Error('The statement period could not be found.');
  return { start: new Date(Number(listing[3]), MONTHS.indexOf(listing[2].toLowerCase()), Number(listing[1])), end: new Date(Number(listing[6]), MONTHS.indexOf(listing[5].toLowerCase()), Number(listing[4])) };
}

function transactionDate(day, month, period) {
  const monthIndex = MONTHS.indexOf(month.toLowerCase());
  if (monthIndex < 0) return undefined;
  return [...new Set([period.start.getFullYear(), period.end.getFullYear()])]
    .map(year => new Date(year, monthIndex, Number(day)))
    .find(date => date >= period.start && date <= period.end);
}

function parseStatement(lines) {
  const text = lines.join('\n'), period = statementPeriod(text), listing = /Transaction Listing/i.test(text), transactions = [];
  let malformed = 0;
  for (const line of lines) {
    const candidate = /^\d{1,2}\s+[A-Za-z]{3}\s+/.test(line) && /\$/.test(line);
    const match = line.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(.+?)\s+(-?\$\s*[\d,]+\.\d{2})(?:\s+(CR))?$/i);
    if (!match) { if (candidate) malformed++; continue; }
    if (/\bPAYMENT\b/i.test(match[3])) continue;
    const date = transactionDate(match[1], match[2], period);
    if (!date) continue;
    const amount = Number(match[4].replace(/[^\d.]/g, ''));
    const spend = listing ? (match[4].startsWith('-') ? amount : -amount) : (match[5] ? -amount : amount);
    transactions.push({ date, spend });
  }
  if (malformed) throw new Error(`${malformed} transaction rows could not be read.`);
  if (!transactions.length) throw new Error('No transaction rows were found in this PDF.');
  const today = dateOnly(new Date()), weekly = new Map();
  for (const transaction of transactions) {
    const weekStart = mondayOf(transaction.date), weekEnd = sundayOf(weekStart);
    if (dateOnly(weekEnd) >= today || dateOnly(weekStart) < period.start || dateOnly(weekEnd) > period.end) continue;
    weekly.set(weekStart, (weekly.get(weekStart) || 0) + transaction.spend);
  }
  const rows = [...weekly].map(([weekStart, amount]) => ({ weekStart, weekEnd: sundayOf(weekStart), amount: Math.max(0, Math.round(amount * 100) / 100) })).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (!rows.length) throw new Error('No fully covered, completed weeks were found.');
  return { rows, transactionCount: transactions.length, period };
}

function statementParserSelfCheck() {
  const { rows } = parseStatement(['(from 01/01/2000 to 31/01/2000):', '3 Jan SHOP $10.00', '4 Jan REFUND $2.00 CR', '5 Jan PAYMENT - BPAY $100.00 CR']);
  if (rows.length !== 1 || rows[0].amount !== 8 || rows[0].weekStart !== '2000-01-03') throw new Error('Statement parser self-check failed.');
}

statementParserSelfCheck();

async function pdfLines(file) {
  if (!window.pdfjsLib) throw new Error('The PDF reader did not load.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, lines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const { items } = await (await pdf.getPage(pageNumber)).getTextContent(), rows = [];
    for (const item of items.filter(item => item.str.trim())) {
      const y = item.transform[5];
      let row = rows.find(candidate => Math.abs(candidate.y - y) < 2);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x: item.transform[4], text: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y).forEach(row => lines.push(row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ').replace(/\s+/g, ' ')));
  }
  return lines;
}

class DataRepository {
  constructor(client, user) { this.client = client; this.user = user; this.cache = {}; this.settings = {}; }
  async init() {
    const tables = ['earnings', 'rentals', 'purchases', 'deposits', 'fixed_costs', 'loan_inputs'];
    const results = await Promise.all([...tables, 'actual_weekly_spend'].map(table => this.client.from(table).select('*')));
    results.forEach((result, index) => { if (result.error) throw result.error; this.cache[[...tables, 'actual_weekly_spend'][index]] = result.data || []; });
    console.info(`[database] ${this.cache.earnings.length} wage-income rows loaded`);
    console.table(this.cache.earnings);
    const settings = await this.client.from('settings').select('key,value');
    if (settings.error) throw settings.error;
    this.settings = Object.fromEntries((settings.data || []).map(row => [row.key, row.value]));
  }
  setting(key) { return this.settings[key] ?? ''; }
  async setSetting(key, value) {
    const row = { user_id: this.user.id, key, value: String(value) };
    const { error } = await this.client.from('settings').upsert(row, { onConflict: 'user_id,key' });
    if (error) throw error;
    this.settings[key] = row.value;
  }
  collection(table, order = 'id') { return [...(this.cache[table] || [])].sort((a, b) => String(a[order] || '').localeCompare(String(b[order] || ''))); }
  async saveActualWeeklySpend(weekStart, weekEnd, amount) { await this.saveActualWeeklySpends([{ weekStart, weekEnd, amount }]); }
  async saveActualWeeklySpends(records) {
    const rows = records.map(record => ({ ...record, user_id: this.user.id }));
    const { data, error } = await this.client.from('actual_weekly_spend').upsert(rows, { onConflict: 'user_id,weekStart' }).select();
    if (error) throw error;
    const starts = new Set(records.map(row => row.weekStart));
    this.cache.actual_weekly_spend = [...(this.cache.actual_weekly_spend || []).filter(row => !starts.has(row.weekStart)), ...(data || rows)];
  }
  async saveCollection(table, fields, records) {
    const dateFields = new Set(['fromDate', 'toDate', 'date', 'depositDate', 'effectiveDate']);
    const rows = records.map(record => ({ ...Object.fromEntries(fields.map(field => [field, dateFields.has(field) && record[field] === '' ? null : record[field]])), user_id: this.user.id }));
    const { error: deleteError } = await this.client.from(table).delete().eq('user_id', this.user.id);
    if (deleteError) throw deleteError;
    if (!rows.length) { this.cache[table] = []; return; }
    const { data, error } = await this.client.from(table).insert(rows).select();
    if (error) throw error;
    this.cache[table] = data || rows;
  }
  getData() {
    return {
      earnings: this.collection('earnings', 'fromDate'), rentals: this.collection('rentals', 'fromDate'),
      purchases: this.collection('purchases', 'date'),
      deposits: this.collection('deposits', 'depositDate').map(row => ({ ...row, depositDate: row.depositDate || row.date })),
      fixedCosts: this.collection('fixed_costs', 'startYear'), loanInputs: this.collection('loan_inputs', 'effectiveDate'),
      actualWeeklySpend: this.collection('actual_weekly_spend', 'weekStart'),
    };
  }
}

function weeklyRepayment(principal, rate, years) {
  const weeks = Number(years) * 52, weeklyRate = Number(rate) / 100 / 52;
  if (!principal || !weeks) return 0;
  if (!weeklyRate) return Number(principal) / weeks;
  return principal * weeklyRate * (1 + weeklyRate) ** weeks / ((1 + weeklyRate) ** weeks - 1);
}

function calculateRedraw(originalLoan, annualRate, loanTermYears, weeksElapsed, actualLoanBalance) {
  const weeklyRate = Number(annualRate) / 100 / 52;
  const totalWeeks = Number(loanTermYears) * 52;
  if (weeksElapsed >= totalWeeks) return 0;
  const scheduledBalance = weeklyRate === 0
    ? originalLoan * (1 - weeksElapsed / totalWeeks)
    : originalLoan * ((Math.pow(1 + weeklyRate, totalWeeks) - Math.pow(1 + weeklyRate, weeksElapsed)) / (Math.pow(1 + weeklyRate, totalWeeks) - 1));
  return Math.max(0, scheduledBalance - actualLoanBalance);
}

function runForecast(settings, data) {
  console.log('[forecast setup]', { loanStartDate: settings.loanStartDate, loanTerm: settings.loanTerm, loanAmount: settings.loanAmount, deposits: data.deposits.map(row => ({ date: row.depositDate || row.date, amount: row.amount })) });
  if (!validDate(settings.loanStartDate) || !settings.loanAmount || !settings.loanTerm) {
    console.warn('[forecast skipped] incomplete loan settings');
    return { weeklyResults: [], totalInterest: 0 };
  }
  const results = [], wageAudit = [], start = dateOnly(mondayOf(settings.loanStartDate)), weeks = Number(settings.loanTerm) * 52;
  const actualByWeek = Object.fromEntries(data.actualWeeklySpend.map(row => [row.weekStart, Number(row.amount)])), currentWeekStart = mondayOf(new Date());
  const initialOffset = data.deposits.filter(row => validDate(row.depositDate || row.date) && dateOnly(row.depositDate || row.date) < start).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  let balance = Number(settings.loanAmount), offset = initialOffset, repayment = weeklyRepayment(balance, settings.interestRate, settings.loanTerm), previousRate, loanFullyPaid = false, redrawBalance = 0;
  if (initialOffset) console.log('[initial offset]', { amount: initialOffset, loanStartDate: settings.loanStartDate });
  for (let week = 0; week < weeks; week++) {
    const current = new Date(start); current.setDate(start.getDate() + week * 7);
    const rateChange = [...data.loanInputs].reverse().find(row => validDate(row.effectiveDate) && dateOnly(row.effectiveDate) <= current);
    const rate = Number(rateChange?.interestRate ?? settings.interestRate);
    if (rate !== previousRate) { repayment = Number(rateChange?.weeklyRepayment) || weeklyRepayment(balance, rate, Math.max((weeks - week) / 52, 1 / 52)); previousRate = rate; }
    const earning = data.earnings.find(row => inRange(current, row.fromDate, row.toDate)) || {};
    if (current.getFullYear() === 2025 || current.getFullYear() === 2026) wageAudit.push({ weekStart: inputDate(current), wageFrom: earning.fromDate || 'NO MATCH', wageTo: earning.toDate || 'NO MATCH', weeklyWage: Number(earning.weeklyWage || 0) });
    const rental = data.rentals.find(row => inRange(current, row.fromDate, row.toDate));
    const fixed = data.fixedCosts.find(row => Number(row.startYear) <= current.getFullYear() && Number(row.endYear) >= current.getFullYear());
    const purchases = data.purchases.filter(row => Number(row.includeFlag) && inRange(dateOnly(row.date), current, new Date(current.getTime() + 6 * 86400000))).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const weekStart = inputDate(current), forecastSpend = Number(earning.weeklySpend || 0), actualSpend = weekStart < currentWeekStart ? actualByWeek[weekStart] : undefined, weeklySpend = actualSpend ?? forecastSpend;
    const matchingDeposits = data.deposits.filter(row => isDateInWeek(row.depositDate || row.date, current));
    const deposits = matchingDeposits.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const weeklyFixed = Number(fixed?.totalYearlyCost || 0) / 52;
    const surplus = Number(earning.weeklyWage || 0) - weeklySpend - weeklyFixed + Number(rental?.weeklyRental || 0) - (balance > 0 ? repayment : 0);
    offset = Math.max(0, offset + surplus + deposits - purchases);
    if (deposits) console.log('[deposit forecast]', { depositDate: matchingDeposits[0].depositDate || matchingDeposits[0].date, weekDate: current.toISOString().slice(0, 10), deposits, offset });
    const interest = Math.max(0, balance - offset) * rate / 100 / 52;
    const principal = Math.max(0, Math.min(repayment - interest, balance));
    balance -= principal;
    if (balance <= 0 && !loanFullyPaid) {
      balance = 0;
      loanFullyPaid = true;
      redrawBalance = calculateRedraw(settings.loanAmount, rate, settings.loanTerm, week + 1, balance);
    }
    if (loanFullyPaid) redrawBalance = Math.max(0, redrawBalance - repayment);
    const redrawAmount = loanFullyPaid ? redrawBalance : calculateRedraw(settings.loanAmount, rate, settings.loanTerm, week + 1, balance);
    results.push({ weekNumber: week + 1, weekDate: current, weekStart, rate, weeklyRental: Number(rental?.weeklyRental || 0), purchases, weeklySpend, forecastSpend, actualSpend: actualSpend ?? null, weeklyDeposits: deposits, interest, principal, repayment, loanBalance: balance, offsetBalance: offset, redrawAmount, gap: offset - balance });
  }
  const wageAuditSignature = JSON.stringify({ loanStartDate: settings.loanStartDate, earnings: data.earnings });
  if (wageAuditSignature !== lastWageAuditSignature) {
    console.groupCollapsed('[forecast wage audit] 2025–2026');
    console.table(wageAudit);
    console.groupEnd();
    lastWageAuditSignature = wageAuditSignature;
  }
  return { weeklyResults: results, totalInterest: results.reduce((sum, row) => sum + row.interest, 0) };
}

class CostProjectorApp {
  constructor() { this.repo = null; this.data = {}; this.settings = {}; this.forecast = { weeklyResults: [] }; this.saveQueue = Promise.resolve(); }
  async start() {
    if (!supabaseClient || !supabaseAnonKey || supabaseAnonKey.startsWith('PASTE_')) throw new Error('Add the Supabase anon key to supabase-config.js.');
    const { data: { session } } = await supabaseClient.auth.getSession();
    supabaseClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') window.location.reload(); });
    if (!session) return this.showAuth();
    this.repo = new DataRepository(supabaseClient, session.user);
    await this.repo.init();
    this.load(); this.bindEvents(); this.render(); this.renderActualSpendControls(); this.showPage('page-forecast');
  }
  showAuth() {
    document.body.classList.add('signed-out');
    const form = document.getElementById('auth-form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const email = document.getElementById('auth-email').value;
      const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
      document.getElementById('auth-message').textContent = error ? error.message : 'Check your email for the sign-in link.';
    });
  }
  load() {
    this.data = this.repo.getData();
    this.settings = { loanStartDate: this.repo.setting('loanStartDate'), loanTerm: Number(this.repo.setting('loanTerm') || this.repo.setting('loanTermYears') || 0), loanAmount: Number(this.repo.setting('loanAmount') || 0), interestRate: Number(this.repo.setting('interestRate') || 0) };
  }
  bindEvents() {
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (event.target.closest('[data-page]')) this.showPage(event.target.closest('[data-page]').dataset.page);
      if (action === 'upload-statement') document.getElementById('statement-upload').click();
      if (action === 'report') this.openForecastReport();
      if (action === 'sign-out') supabaseClient.auth.signOut();
      if (action === 'save-actual-spend') this.saveActualSpend();
      if (action === 'add-earning') this.add('earnings', { fromDate: '', toDate: '', weeklyWage: 0, weeklySpend: 0 });
      if (action === 'add-fixed') this.add('fixedCosts', { startYear: 0, endYear: 0, totalYearlyCost: 0 });
      if (action === 'add-deposit') this.add('deposits', { depositDate: '', description: '', amount: 0 });
      if (action === 'add-rental') this.add('rentals', { fromDate: '', toDate: '', weeklyRental: 0 });
      if (action === 'delete-rental' && this.data.rentals.length > 1) { this.data.rentals.pop(); this.save(); this.render(); }
      if (action === 'delete-deposit' && this.data.deposits.length > 1) { this.data.deposits.pop(); this.save(); this.render(); }
      if (action === 'add-purchase') this.add('purchases', { date: '', description: '', amount: 0, includeFlag: 1 });
      if (action === 'add-rate') this.addRate();
      if (event.target.closest('[data-delete]')) this.remove(event.target.closest('[data-delete]').dataset.delete, event.target.closest('[data-delete]').dataset.id);
    });
    document.addEventListener('input', event => { if (event.target.matches('#actualWeekStart')) this.renderActualSpendControls(); if (event.target.matches('#loanStartDate,#loanTerm,#loanAmount,#interestRate')) this.saveSettings(); const table = event.target.closest('[data-table]')?.dataset.table; if (table) { const row = event.target.closest('[data-row]'); this.readRow(row); this.save(); if (table === 'deposits' && event.target.name === 'amount') console.log('[deposit input]', { id: row.dataset.id, date: row.querySelector('[name="depositDate"]').value, amount: row.querySelector('[name="amount"]').value }); } if (event.target.matches('#targetDate,#targetAmount')) this.refresh(); if (event.target.matches('#changeRate')) this.updateChangeRepayment(); this.refresh(false); this.renderSettings(); this.renderForecast(); });
    document.addEventListener('keydown', event => { if (event.key !== 'Enter' || event.target.name !== 'amount' || !event.target.closest('[data-table="deposits"]')) return; const row = event.target.closest('[data-row]'); console.log('[deposit Enter]', { id: row.dataset.id, date: row.querySelector('[name="depositDate"]').value, amount: row.querySelector('[name="amount"]').value }); });
    document.getElementById('statement-upload').addEventListener('change', event => { const files = [...event.target.files]; if (files.length) this.importStatements(files); });
  }
  async importStatements(files) {
    const status = document.getElementById('statement-import-status'), weekly = new Map();
    let transactionCount = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (!/\.pdf$/i.test(file.name)) throw new Error(`${file.name} is not a PDF statement.`);
        status.textContent = `Reading statement ${index + 1} of ${files.length}…`;
        const parsed = parseStatement(await pdfLines(file));
        transactionCount += parsed.transactionCount;
        for (const row of parsed.rows) {
          const existing = weekly.get(row.weekStart);
          if (existing && existing.amount !== row.amount) throw new Error(`Statements contain conflicting totals for week ${row.weekStart}.`);
          weekly.set(row.weekStart, row);
        }
      }
      const rows = [...weekly.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      const existing = new Set(this.data.actualWeeklySpend.map(row => row.weekStart)), replacements = rows.filter(row => existing.has(row.weekStart)).length;
      const total = rows.reduce((sum, row) => sum + row.amount, 0);
      const preview = [`${files.length} statements`, `${transactionCount} transactions found`, `${rows.length} complete weeks: ${rows[0].weekStart} to ${rows.at(-1).weekEnd}`, `${money(total)} spending`, `${replacements} existing weeks will be replaced`, '', 'Import these weekly totals?'].join('\n');
      if (!window.confirm(preview)) { status.textContent = 'Import cancelled.'; return; }
      await this.repo.saveActualWeeklySpends(rows);
      this.data = this.repo.getData();
      this.refresh();
      this.renderActualSpendControls();
      status.textContent = `${files.length} statements and ${rows.length} weeks imported.`;
    } catch (error) {
      console.error(error);
      status.textContent = error.message || 'The statements could not be imported.';
    } finally {
      document.getElementById('statement-upload').value = '';
    }
  }
  add(table, record) { record.id = id(); this.data[table].push(record); this.save(); this.render(); }
  addRate() { const date = document.getElementById('changeDate').value, rate = Number(document.getElementById('changeRate').value || 0); if (!date) return; this.data.loanInputs.push({ id: id(), effectiveDate: date, interestRate: rate, weeklyRepayment: Number(document.getElementById('changeRepayment').value || 0) }); this.save(); this.render(); }
  remove(table, recordId) { this.data[table] = this.data[table].filter(row => String(row.id) !== String(recordId)); this.save(); this.render(); }
  renderActualSpendControls() {
    const startInput = document.getElementById('actualWeekStart'), endInput = document.getElementById('actualWeekEnd'), amountInput = document.getElementById('actualWeeklySpend'), saveButton = document.querySelector('[data-action="save-actual-spend"]'), message = document.getElementById('actual-spend-message');
    if (!startInput) return;
    startInput.value = mondayOf(startInput.value || new Date());
    endInput.value = sundayOf(startInput.value);
    const actual = this.data.actualWeeklySpend.find(row => row.weekStart === startInput.value);
    amountInput.value = actual?.amount ?? '';
    const complete = dateOnly(endInput.value) < dateOnly(new Date());
    amountInput.disabled = !complete;
    saveButton.disabled = !complete;
    message.textContent = '';
  }
  async saveActualSpend() {
    const start = document.getElementById('actualWeekStart').value, end = sundayOf(start), amount = Number(document.getElementById('actualWeeklySpend').value), message = document.getElementById('actual-spend-message');
    if (start !== mondayOf(start)) { message.textContent = 'Week start must be a Monday.'; return; }
    if (dateOnly(end) >= dateOnly(new Date())) { message.textContent = 'Only completed weeks can be saved.'; return; }
    if (!Number.isFinite(amount) || amount < 0) { message.textContent = 'Enter a valid spend amount.'; return; }
    try { await this.repo.saveActualWeeklySpend(start, end, amount); this.data = this.repo.getData(); this.refresh(); this.renderActualSpendControls(); message.textContent = 'Actual spend saved.'; } catch (error) { console.error(error); message.textContent = 'Actual spend could not be saved.'; }
  }
  saveSettings() { this.settings = { loanStartDate: document.getElementById('loanStartDate').value, loanTerm: Number(document.getElementById('loanTerm').value || 0), loanAmount: Number(document.getElementById('loanAmount').value || 0), interestRate: Number(document.getElementById('interestRate').value || 0) }; Object.entries(this.settings).forEach(([key, value]) => this.repo.setSetting(key, value).catch(error => console.error('Could not save setting', error))); }
  readRow(row) { const table = row.closest('[data-table]').dataset.table, record = this.data[table].find(item => String(item.id) === row.dataset.id); if (!record) return; row.querySelectorAll('[name]').forEach(input => { record[input.name] = input.type === 'checkbox' ? (input.checked ? 1 : 0) : input.type === 'number' ? Number(input.value || 0) : input.value; }); }
  save() { const specs = { earnings: ['id','fromDate','toDate','weeklyWage','weeklySpend'], rentals: ['id','fromDate','toDate','weeklyRental'], purchases: ['id','date','description','amount','includeFlag'], deposits: ['id','depositDate','description','amount'], fixedCosts: ['id','startYear','endYear','totalYearlyCost'], loanInputs: ['id','effectiveDate','interestRate','weeklyRepayment'] }; this.saveQueue = this.saveQueue.then(() => Promise.all(Object.entries(specs).map(([table, fields]) => this.repo.saveCollection(table === 'fixedCosts' ? 'fixed_costs' : table === 'loanInputs' ? 'loan_inputs' : table, fields, this.data[table])))).catch(error => console.error('Could not save planner data', error)); return this.saveQueue; }
  refresh(render = true) { this.forecast = runForecast(this.settings, this.data); if (render) this.render(); }
  showPage(page) { document.querySelectorAll('.app-page').forEach(section => section.classList.toggle('active', section.id === page)); document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.page === page)); }
  render() { this.refresh(false); this.renderSettings(); this.renderRows('earning-container', 'earnings', [['date','fromDate'],['date','toDate'],['number','weeklyWage'],['number','weeklySpend']]); this.renderRows('fixed-cost-container', 'fixedCosts', [['number','startYear'],['number','endYear'],['number','totalYearlyCost']]); this.renderRows('offset-deposit-container', 'deposits', [['date','depositDate'],['text','description'],['number','amount']]); this.renderRows('rental-container', 'rentals', [['date','fromDate'],['date','toDate'],['number','weeklyRental']]); this.renderRows('purchase-container', 'purchases', [['date','date'],['text','description'],['number','amount'],['checkbox','includeFlag']]); this.renderForecast(); }
  renderSettings() { ['loanStartDate','loanTerm','loanAmount','interestRate'].forEach(key => { const input = document.getElementById(key); if (input) input.value = this.settings[key] || ''; }); document.getElementById('weeklyRepayment').value = money(weeklyRepayment(this.settings.loanAmount, this.settings.interestRate, this.settings.loanTerm)); document.getElementById('changeRepayment').value = money(weeklyRepayment(this.settings.loanAmount, Number(document.getElementById('changeRate').value || 0), this.settings.loanTerm)); this.renderCards('interest-cost-grid', 'interest', year => money(this.forecast.weeklyResults.filter(row => row.weekDate.getFullYear() === year).reduce((sum, row) => sum + row.interest, 0)), Infinity); this.renderCards('offset-balance-grid', 'offset', year => money(this.forecast.weeklyResults.filter(row => row.weekDate.getFullYear() === year).at(-1)?.offsetBalance), Infinity); const rows = this.forecast.weeklyResults, milestone = [...rows].reverse().find(row => row.gap < 0); this.setValue('offsetDate', displayDate(milestone?.weekDate.toISOString().slice(0,10))); this.setValue('offsetBalanceEqual', money(milestone?.offsetBalance)); this.setValue('totalInterestCost', money(this.forecast.totalInterest)); this.setValue('interestSaved', money(weeklyRepayment(this.settings.loanAmount, this.settings.interestRate, this.settings.loanTerm) * this.settings.loanTerm * 52 - this.forecast.totalInterest - this.settings.loanAmount)); this.setValue('timeSaved', milestone ? `${((this.settings.loanTerm * 52 - milestone.weekNumber) / 52).toFixed(1)} years` : ''); const targetDate = document.getElementById('targetDate').value, targetAmount = Number(document.getElementById('targetAmount').value || 0); this.setValue('targetDateResult', money(rows.find(row => row.weekDate.toISOString().slice(0,10) >= targetDate)?.offsetBalance)); this.setValue('targetAmountResult', displayDate(rows.find(row => row.gap >= targetAmount)?.weekDate.toISOString().slice(0,10))); }
  setValue(id, value) { const element = document.getElementById(id); if (element) element.value = value || ''; }
  renderCards(containerId, type, value, limit = 6) { const container = document.getElementById(containerId), years = [...new Set(this.forecast.weeklyResults.map(row => row.weekDate.getFullYear()))].filter(year => year <= 2035).slice(0, limit); container.innerHTML = ''; for (let i = 0; i < Math.max(6, years.length); i++) { const year = years[i] || ''; container.insertAdjacentHTML('beforeend', `<div class="card"><label>${year || `Year ${i + 1}`}</label><input readonly value="${year ? value(year) : ''}"></div>`); } }
  renderRows(containerId, table, fields, actions = false) { const container = document.getElementById(containerId); container.dataset.table = table; container.innerHTML = ''; const records = this.data[table].length ? this.data[table] : (this.data[table].push({ id: id() }), this.data[table]); records.forEach(record => { const row = document.createElement('div'); row.className = `${containerId.replace('-container','')}-row ${containerId === 'rental-container' ? 'four-card-grid' : containerId === 'purchase-container' ? 'purchase-grid' : containerId === 'offset-deposit-container' ? 'offset-grid' : containerId.replace('-container','-grid')}`; row.dataset.row = ''; row.dataset.id = record.id; row.innerHTML = fields.map(([type, name]) => `<div class="card"><input type="${type}" name="${name}" ${type === 'checkbox' && Number(record[name]) ? 'checked' : ''}></div>`).join('') + (actions ? `<div class="card"><button type="button" data-delete="${table}">Delete</button></div>` : ''); row.querySelectorAll('[name]').forEach(input => { if (input.type !== 'checkbox') input.value = record[input.name] ?? ''; }); container.appendChild(row); }); }
  renderPurchaseTotal() { this.setValue('purchase-total', money(this.data.purchases.filter(row => Number(row.includeFlag)).reduce((sum, row) => sum + Number(row.amount || 0), 0))); }
  renderForecast() { this.renderPurchaseTotal(); const container = document.getElementById('forecast-container'); const quarters = {}; this.forecast.weeklyResults.forEach(row => { const key = `${row.weekDate.getFullYear()}-Q${Math.floor(row.weekDate.getMonth()/3)+1}`; quarters[key] = { ...row, spend: (quarters[key]?.spend || 0) + row.purchases, deposits: (quarters[key]?.deposits || 0) + row.weeklyDeposits }; }); container.innerHTML = Object.entries(quarters).map(([period, row]) => `<div class="forecast-grid forecast-row"><div class="card period">${period}</div><div class="card">${money(row.spend)}</div><div class="card">${money(row.deposits)}</div><div class="card">${money(row.offsetBalance)}</div><div class="card">${money(row.loanBalance)}</div><div class="card">${money(row.redrawAmount)}</div><div class="card">${money(row.gap)}</div></div>`).join(''); }
  updateChangeRepayment() { document.getElementById('changeRepayment').value = money(weeklyRepayment(this.settings.loanAmount, Number(document.getElementById('changeRate').value || 0), this.settings.loanTerm)); }
  openForecastReport() { localStorage.setItem('forecastResults', JSON.stringify(this.forecast.weeklyResults)); window.open('ExcelStyleWeekly.html', '_blank'); }
}

new CostProjectorApp().start().catch(error => { console.error(error); document.body.insertAdjacentHTML('afterbegin', '<p role="alert">The planner could not load its database.</p>'); });
