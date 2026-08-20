const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS earnings (id TEXT PRIMARY KEY, fromDate TEXT, toDate TEXT, weeklyWage REAL, weeklySpend REAL);
CREATE TABLE IF NOT EXISTS rentals (id TEXT PRIMARY KEY, fromDate TEXT, toDate TEXT, weeklyRental REAL);
CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, date TEXT, description TEXT, amount REAL, includeFlag INTEGER);
CREATE TABLE IF NOT EXISTS deposits (id TEXT PRIMARY KEY, depositDate TEXT, description TEXT, amount REAL);
CREATE TABLE IF NOT EXISTS fixed_costs (id TEXT PRIMARY KEY, startYear INTEGER, endYear INTEGER, totalYearlyCost REAL);
CREATE TABLE IF NOT EXISTS loan_inputs (id TEXT PRIMARY KEY, effectiveDate TEXT, interestRate REAL, weeklyRepayment REAL);`;

const id = () => crypto.randomUUID();
const money = value => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const dateOnly = value => {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date(NaN);
};
const validDate = value => value && !Number.isNaN(dateOnly(value).getTime());
const inRange = (date, from, to) => validDate(from) && validDate(to) && dateOnly(date) >= dateOnly(from) && dateOnly(date) <= dateOnly(to);
const isDateInWeek = (value, weekStart) => inRange(value, weekStart, new Date(dateOnly(weekStart).getTime() + 6 * 86400000));

class DataRepository {
  async init() {
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
    const saved = localStorage.getItem('forecastDB');
    this.db = saved ? new SQL.Database(new Uint8Array(JSON.parse(saved))) : new SQL.Database();
    this.db.run(SCHEMA);
    const fixedColumns = this.rows('PRAGMA table_info(fixed_costs)').map(column => column.name);
    if (!fixedColumns.includes('startYear')) this.db.run('ALTER TABLE fixed_costs ADD COLUMN startYear INTEGER');
    if (!fixedColumns.includes('endYear')) this.db.run('ALTER TABLE fixed_costs ADD COLUMN endYear INTEGER');
    if (!fixedColumns.includes('totalYearlyCost')) this.db.run('ALTER TABLE fixed_costs ADD COLUMN totalYearlyCost REAL');
    if (fixedColumns.includes('year')) this.db.run('UPDATE fixed_costs SET startYear = COALESCE(startYear, year), endYear = COALESCE(endYear, year), totalYearlyCost = COALESCE(totalYearlyCost, insurance + rego + rates + bodyCorporate)');
    this.save();
  }
  save() { localStorage.setItem('forecastDB', JSON.stringify(Array.from(this.db.export()))); }
  rows(sql, params = []) {
    const result = this.db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map(row => Object.fromEntries(result[0].columns.map((key, i) => [key, row[i]])));
  }
  run(sql, params = []) { this.db.run(sql, params); this.save(); }
  setting(key) { return this.rows('SELECT value FROM settings WHERE key = ?', [key])[0]?.value ?? ''; }
  setSetting(key, value) { this.run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', [key, String(value)]); }
  collection(table, order = 'id') { return this.rows(`SELECT * FROM ${table} ORDER BY ${order}`); }
  saveCollection(table, fields, records) {
    this.db.run(`DELETE FROM ${table}`);
    const savedFields = table === 'purchases' || table === 'loan_inputs' ? fields : fields.filter(field => field !== 'id');
    const keys = savedFields.join(',');
    const marks = savedFields.map(() => '?').join(',');
    records.forEach(record => this.db.run(`INSERT INTO ${table}(${keys}) VALUES(${marks})`, savedFields.map(field => record[field])));
    this.save();
  }
  getData() {
    return {
      earnings: this.collection('earnings', 'fromDate'), rentals: this.collection('rentals', 'fromDate'),
      purchases: this.collection('purchases', 'date'),
      deposits: this.collection('deposits', 'depositDate').map(row => ({ ...row, depositDate: row.depositDate || row.date })),
      fixedCosts: this.collection('fixed_costs', 'startYear'), loanInputs: this.collection('loan_inputs', 'effectiveDate'),
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
  const results = [], start = dateOnly(settings.loanStartDate), weeks = Number(settings.loanTerm) * 52;
  const initialOffset = data.deposits.filter(row => validDate(row.depositDate || row.date) && dateOnly(row.depositDate || row.date) < start).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  let balance = Number(settings.loanAmount), offset = initialOffset, repayment = weeklyRepayment(balance, settings.interestRate, settings.loanTerm), previousRate, loanFullyPaid = false, redrawBalance = 0;
  if (initialOffset) console.log('[initial offset]', { amount: initialOffset, loanStartDate: settings.loanStartDate });
  for (let week = 0; week < weeks; week++) {
    const current = new Date(start); current.setDate(start.getDate() + week * 7);
    const rateChange = [...data.loanInputs].reverse().find(row => validDate(row.effectiveDate) && dateOnly(row.effectiveDate) <= current);
    const rate = Number(rateChange?.interestRate ?? settings.interestRate);
    if (rate !== previousRate) { repayment = Number(rateChange?.weeklyRepayment) || weeklyRepayment(balance, rate, Math.max((weeks - week) / 52, 1 / 52)); previousRate = rate; }
    const earning = data.earnings.find(row => inRange(current, row.fromDate, row.toDate)) || {};
    const rental = data.rentals.find(row => inRange(current, row.fromDate, row.toDate));
    const fixed = data.fixedCosts.find(row => Number(row.startYear) <= current.getFullYear() && Number(row.endYear) >= current.getFullYear());
    const purchases = data.purchases.filter(row => Number(row.includeFlag) && inRange(dateOnly(row.date), current, new Date(current.getTime() + 6 * 86400000))).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const matchingDeposits = data.deposits.filter(row => isDateInWeek(row.depositDate || row.date, current));
    const deposits = matchingDeposits.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const weeklyFixed = Number(fixed?.totalYearlyCost || 0) / 52;
    const surplus = Number(earning.weeklyWage || 0) - Number(earning.weeklySpend || 0) - weeklyFixed + Number(rental?.weeklyRental || 0) - (balance > 0 ? repayment : 0);
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
    results.push({ weekNumber: week + 1, weekDate: current, rate, weeklyRental: Number(rental?.weeklyRental || 0), purchases, weeklyDeposits: deposits, interest, principal, repayment, loanBalance: balance, offsetBalance: offset, redrawAmount, gap: offset - balance });
  }
  return { weeklyResults: results, totalInterest: results.reduce((sum, row) => sum + row.interest, 0) };
}

class CostProjectorApp {
  constructor() { this.repo = new DataRepository(); this.data = {}; this.settings = {}; this.forecast = { weeklyResults: [] }; }
  async start() {
    await this.repo.init();
    this.load(); this.bindEvents(); this.render(); this.showPage('page-forecast');
  }
  load() {
    this.data = this.repo.getData();
    this.settings = { loanStartDate: this.repo.setting('loanStartDate'), loanTerm: Number(this.repo.setting('loanTerm') || this.repo.setting('loanTermYears') || 0), loanAmount: Number(this.repo.setting('loanAmount') || 0), interestRate: Number(this.repo.setting('interestRate') || 0) };
  }
  bindEvents() {
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (event.target.closest('[data-page]')) this.showPage(event.target.closest('[data-page]').dataset.page);
      if (action === 'update') this.refresh();
      if (action === 'report') this.openForecastReport();
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
    document.addEventListener('input', event => { if (event.target.matches('#loanStartDate,#loanTerm,#loanAmount,#interestRate')) this.saveSettings(); const table = event.target.closest('[data-table]')?.dataset.table; if (table) { const row = event.target.closest('[data-row]'); this.readRow(row); this.save(); if (table === 'deposits' && event.target.name === 'amount') console.log('[deposit input]', { id: row.dataset.id, date: row.querySelector('[name="depositDate"]').value, amount: row.querySelector('[name="amount"]').value }); } if (event.target.matches('#targetDate,#targetAmount')) this.refresh(); if (event.target.matches('#changeRate')) this.updateChangeRepayment(); this.refresh(false); this.renderSettings(); this.renderForecast(); });
    document.addEventListener('keydown', event => { if (event.key !== 'Enter' || event.target.name !== 'amount' || !event.target.closest('[data-table="deposits"]')) return; const row = event.target.closest('[data-row]'); console.log('[deposit Enter]', { id: row.dataset.id, date: row.querySelector('[name="depositDate"]').value, amount: row.querySelector('[name="amount"]').value }); });
  }
  add(table, record) { record.id = id(); this.data[table].push(record); this.save(); this.render(); }
  addRate() { const date = document.getElementById('changeDate').value, rate = Number(document.getElementById('changeRate').value || 0); if (!date) return; this.data.loanInputs.push({ id: id(), effectiveDate: date, interestRate: rate, weeklyRepayment: Number(document.getElementById('changeRepayment').value || 0) }); this.save(); this.render(); }
  remove(table, recordId) { this.data[table] = this.data[table].filter(row => String(row.id) !== String(recordId)); this.save(); this.render(); }
  saveSettings() { this.settings = { loanStartDate: document.getElementById('loanStartDate').value, loanTerm: Number(document.getElementById('loanTerm').value || 0), loanAmount: Number(document.getElementById('loanAmount').value || 0), interestRate: Number(document.getElementById('interestRate').value || 0) }; Object.entries(this.settings).forEach(([key, value]) => this.repo.setSetting(key, value)); }
  readRow(row) { const table = row.closest('[data-table]').dataset.table, record = this.data[table].find(item => String(item.id) === row.dataset.id); if (!record) return; row.querySelectorAll('[name]').forEach(input => { record[input.name] = input.type === 'checkbox' ? (input.checked ? 1 : 0) : input.type === 'number' ? Number(input.value || 0) : input.value; }); }
  save() { const specs = { earnings: ['id','fromDate','toDate','weeklyWage','weeklySpend'], rentals: ['id','fromDate','toDate','weeklyRental'], purchases: ['id','date','description','amount','includeFlag'], deposits: ['id','depositDate','description','amount'], fixedCosts: ['id','startYear','endYear','totalYearlyCost'], loanInputs: ['id','effectiveDate','interestRate','weeklyRepayment'] }; Object.entries(specs).forEach(([table, fields]) => this.repo.saveCollection(table === 'fixedCosts' ? 'fixed_costs' : table === 'loanInputs' ? 'loan_inputs' : table, fields, this.data[table])); }
  refresh(render = true) { this.forecast = runForecast(this.settings, this.data); if (render) this.render(); }
  showPage(page) { document.querySelectorAll('.app-page').forEach(section => section.classList.toggle('active', section.id === page)); document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.page === page)); }
  render() { this.refresh(false); this.renderSettings(); this.renderRows('earning-container', 'earnings', [['date','fromDate'],['date','toDate'],['number','weeklyWage'],['number','weeklySpend']]); this.renderRows('fixed-cost-container', 'fixedCosts', [['number','startYear'],['number','endYear'],['number','totalYearlyCost']]); this.renderRows('offset-deposit-container', 'deposits', [['date','depositDate'],['text','description'],['number','amount']]); this.renderRows('rental-container', 'rentals', [['date','fromDate'],['date','toDate'],['number','weeklyRental']]); this.renderRows('purchase-container', 'purchases', [['date','date'],['text','description'],['number','amount'],['checkbox','includeFlag']]); this.renderForecast(); }
  renderSettings() { ['loanStartDate','loanTerm','loanAmount','interestRate'].forEach(key => { const input = document.getElementById(key); if (input) input.value = this.settings[key] || ''; }); document.getElementById('weeklyRepayment').value = money(weeklyRepayment(this.settings.loanAmount, this.settings.interestRate, this.settings.loanTerm)); document.getElementById('changeRepayment').value = money(weeklyRepayment(this.settings.loanAmount, Number(document.getElementById('changeRate').value || 0), this.settings.loanTerm)); this.renderCards('interest-cost-grid', 'interest', year => money(this.forecast.weeklyResults.filter(row => row.weekDate.getFullYear() === year).reduce((sum, row) => sum + row.interest, 0))); this.renderCards('offset-balance-grid', 'offset', year => money(this.forecast.weeklyResults.filter(row => row.weekDate.getFullYear() === year).at(-1)?.offsetBalance)); const rows = this.forecast.weeklyResults, milestone = rows.find(row => row.gap >= 0); this.setValue('offsetDate', milestone?.weekDate.toISOString().slice(0,10)); this.setValue('offsetBalanceEqual', money(milestone?.offsetBalance)); this.setValue('totalInterestCost', money(this.forecast.totalInterest)); this.setValue('interestSaved', money(weeklyRepayment(this.settings.loanAmount, this.settings.interestRate, this.settings.loanTerm) * this.settings.loanTerm * 52 - this.forecast.totalInterest - this.settings.loanAmount)); this.setValue('timeSaved', milestone ? `${((this.settings.loanTerm * 52 - milestone.weekNumber) / 52).toFixed(1)} years` : ''); const targetDate = document.getElementById('targetDate').value, targetAmount = Number(document.getElementById('targetAmount').value || 0); this.setValue('targetDateResult', money(rows.find(row => row.weekDate.toISOString().slice(0,10) >= targetDate)?.offsetBalance)); this.setValue('targetAmountResult', rows.find(row => row.offsetBalance >= targetAmount)?.weekDate.toISOString().slice(0,10) || ''); }
  setValue(id, value) { const element = document.getElementById(id); if (element) element.value = value || ''; }
  renderCards(containerId, type, value) { const container = document.getElementById(containerId), years = [...new Set(this.forecast.weeklyResults.map(row => row.weekDate.getFullYear()))].slice(0, 6); container.innerHTML = ''; for (let i = 0; i < 6; i++) { const year = years[i] || ''; container.insertAdjacentHTML('beforeend', `<div class="card"><label>${year || `Year ${i + 1}`}</label><input readonly value="${year ? value(year) : ''}"></div>`); } }
  renderRows(containerId, table, fields, actions = false) { const container = document.getElementById(containerId); container.dataset.table = table; container.innerHTML = ''; const records = this.data[table].length ? this.data[table] : (this.data[table].push({ id: id() }), this.data[table]); records.forEach(record => { const row = document.createElement('div'); row.className = `${containerId.replace('-container','')}-row ${containerId === 'rental-container' ? 'four-card-grid' : containerId === 'purchase-container' ? 'purchase-grid' : containerId === 'offset-deposit-container' ? 'offset-grid' : containerId.replace('-container','-grid')}`; row.dataset.row = ''; row.dataset.id = record.id; row.innerHTML = fields.map(([type, name]) => `<div class="card"><input type="${type}" name="${name}" ${type === 'checkbox' && Number(record[name]) ? 'checked' : ''}></div>`).join('') + (actions ? `<div class="card"><button type="button" data-delete="${table}">Delete</button></div>` : ''); row.querySelectorAll('[name]').forEach(input => { if (input.type !== 'checkbox') input.value = record[input.name] ?? ''; }); container.appendChild(row); }); }
  renderForecast() { const container = document.getElementById('forecast-container'); const quarters = {}; this.forecast.weeklyResults.forEach(row => { const key = `${row.weekDate.getFullYear()}-Q${Math.floor(row.weekDate.getMonth()/3)+1}`; quarters[key] = { ...row, spend: (quarters[key]?.spend || 0) + row.purchases, deposits: (quarters[key]?.deposits || 0) + row.weeklyDeposits }; }); container.innerHTML = Object.entries(quarters).map(([period, row]) => `<div class="forecast-grid forecast-row"><div class="card period">${period}</div><div class="card">${money(row.spend)}</div><div class="card">${money(row.deposits)}</div><div class="card">${money(row.offsetBalance)}</div><div class="card">${money(row.loanBalance)}</div><div class="card">${money(row.redrawAmount)}</div><div class="card">${money(row.gap)}</div></div>`).join(''); }
  updateChangeRepayment() { document.getElementById('changeRepayment').value = money(weeklyRepayment(this.settings.loanAmount, Number(document.getElementById('changeRate').value || 0), this.settings.loanTerm)); }
  openForecastReport() { localStorage.setItem('forecastResults', JSON.stringify(this.forecast.weeklyResults)); window.open('ExcelStyleWeekly.html', '_blank'); }
}

new CostProjectorApp().start().catch(error => { console.error(error); document.body.insertAdjacentHTML('afterbegin', '<p role="alert">The planner could not load its database.</p>'); });
