/* =====================================================
   COST PROJECTOR - MODULAR ARCHITECTURE
   Refactored by: Abused Designer
===================================================== */

class DataRepository {
  constructor() { this.db = null; }

  async init() {
    if (typeof initSqlJs === 'undefined') throw new Error("sql.js not loaded");
    const SQL = await initSqlJs({ locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
    const savedDb = localStorage.getItem("forecastDB");
    this.db = savedDb ? new SQL.Database(new Uint8Array(JSON.parse(savedDb))) : new SQL.Database();
    if (!savedDb) this.bootstrap();
  }

  bootstrap() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS earnings (id INTEGER PRIMARY KEY AUTOINCREMENT, fromDate TEXT, toDate TEXT, weeklyWage REAL, weeklySpend REAL);
      CREATE TABLE IF NOT EXISTS rentals (id INTEGER PRIMARY KEY AUTOINCREMENT, fromDate TEXT, toDate TEXT, weeklyRental REAL);
      CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, date TEXT, description TEXT, amount REAL, includeFlag INTEGER);
      CREATE TABLE IF NOT EXISTS deposits (id INTEGER PRIMARY KEY AUTOINCREMENT, depositDate TEXT, description TEXT, amount REAL);
      CREATE TABLE IF NOT EXISTS fixed_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER, insurance REAL, rego REAL, rates REAL, bodyCorporate REAL);
      CREATE TABLE IF NOT EXISTS loan_inputs (id TEXT PRIMARY KEY, effectiveDate TEXT, interestRate REAL, weeklyRepayment REAL);
    `);
    this.save();
  }

  save() { localStorage.setItem("forecastDB", JSON.stringify(Array.from(this.db.export()))); }
  run(sql, params = []) { this.db.run(sql, params); this.save(); }
  select(sql, params = []) {
    const res = this.db.exec(sql, params);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => Object.fromEntries(cols.map((col, i) => [col, row[i]])));
  }

  getEarnings() { return this.select("SELECT * FROM earnings ORDER BY fromDate"); }
  saveEarnings(data) {
    this.run("DELETE FROM earnings");
    data.forEach(d => this.run("INSERT INTO earnings (fromDate, toDate, weeklyWage, weeklySpend) VALUES (?, ?, ?, ?)", [d.fromDate, d.toDate, d.weeklyWage, d.weeklySpend]));
  }

  getRentals() { return this.select("SELECT * FROM rentals ORDER BY fromDate"); }
  saveRentals(data) {
    this.run("DELETE FROM rentals");
    data.forEach(d => this.run("INSERT INTO rentals (fromDate, toDate, weeklyRental) VALUES (?, ?, ?)", [d.fromDate, d.toDate, d.weeklyRental]));
  }

  getPurchases() { return this.select("SELECT * FROM purchases"); }
  savePurchases(data) {
    this.run("DELETE FROM purchases");
    data.forEach(d => this.run("INSERT INTO purchases (id, date, description, amount, includeFlag) VALUES (?, ?, ?, ?, ?)", [d.id, d.date, d.description, d.amount, d.include ? 1 : 0]));
  }
}

class FinancialEngine {
  static calculateWeeklyRepayment(principal, annualRate, years) {
    const weeklyRate = annualRate / 100 / 52;
    const totalWeeks = years * 52;
    if (weeklyRate === 0) return principal / totalWeeks;
    return (principal * weeklyRate * Math.pow(1 + weeklyRate, totalWeeks)) / (Math.pow(1 + weeklyRate, totalWeeks) - 1);
  }

  static calculateLoanWeek({ balance, offset, rate, repayment }) {
    if (balance <= 0) return { interest: 0, principal: 0, newBalance: 0 };
    const weeklyRate = rate / 100 / 52;
    const interest = Math.max(0, balance - offset) * weeklyRate;
    const principal = Math.max(0, Math.min(repayment - interest, balance));
    return { interest, principal, newBalance: balance - principal };
  }
}

class ForecastEngine {
  static getWeeklyInputs(currentDate, data) {
    const earningsRow = data.earnings.find(e => {
        const forecastDate = new Date(currentDate); forecastDate.setHours(0,0,0,0);
        const from = new Date(e.fromDate); from.setHours(0,0,0,0);
        const to = new Date(e.toDate); to.setHours(23,59,59,999);
        return forecastDate >= from && forecastDate <= to;
    }) || { weeklyWage: 0, weeklySpend: 0 };

    const purchases = data.purchases.reduce((total, p) => {
        if (!p.includeFlag) return total;
        const pDate = new Date(p.date);
        const wEnd = new Date(currentDate); wEnd.setDate(wEnd.getDate() + 6);
        return (pDate >= currentDate && pDate <= wEnd) ? total + Number(p.amount) : total;
    }, 0);

    const deposits = data.deposits.reduce((total, d) => {
        const dDate = new Date(d.depositDate);
        const wEnd = new Date(currentDate); wEnd.setDate(wEnd.getDate() + 6);
        return (dDate >= currentDate && dDate <= wEnd) ? total + Number(d.amount) : total;
    }, 0);

    const rental = data.rentals.find(r => currentDate >= new Date(r.fromDate) && currentDate <= new Date(r.toDate));
    return { earningsRow, weeklyPurchases: purchases, weeklyDeposits: deposits, weeklyRental: Number(rental?.weeklyRental || 0) };
  }
}

class CostProjectorApp {
  constructor() {
    this.repo = new DataRepository();
    this.state = {
      loanSettings: { loanStartDate: '', loanTerm: 0, loanAmount: 0, interestRate: 0 },
      currentPage: 'page-forecast'
    };
  }

  async start() {
    await this.repo.init();
    this.loadInitialState();
    this.bindEvents();
    this.render();
  }

  loadInitialState() {
    const settings = this.repo.select("SELECT * FROM settings");
    settings.forEach(s => { if (this.state.loanSettings.hasOwnProperty(s.key)) this.state.loanSettings[s.key] = s.value; });
  }

  bindEvents() {
    document.addEventListener('click', (e) => {
      const pageBtn = e.target.closest('[data-page]');
      if (pageBtn) this.showPage(pageBtn.dataset.page);
      if (e.target.id === 'add-earning-row') this.addEarning();
      if (e.target.id === 'add-purchase-btn') this.addPurchase();
      if (e.target.id === 'add-rental-row') this.addRental();
    });

    document.addEventListener('input', (e) => {
      if (!e.target.classList.contains('save-trigger')) return;
      if (['loanStartDate', 'loanTerm', 'loanAmount', 'interestRate'].includes(e.target.name)) {
        this.updateStateFromDOM();
        this.repo.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [e.target.name, e.target.value]);
      }
      const container = e.target.closest('[id$="-container"]');
      if (container) this.persistContainer(container.id);
      this.render();
    });
  }

  addEarning() { this.repo.run("INSERT INTO earnings (fromDate, toDate, weeklyWage, weeklySpend) VALUES (?, ?, ?, ?)", ['', '', 0, 0]); this.render(); }
  addPurchase() { this.repo.run("INSERT INTO purchases (id, date, description, amount, includeFlag) VALUES (?, ?, ?, ?, ?)", [crypto.randomUUID(), '', '', 0, 1]); this.render(); }
  addRental() { this.repo.run("INSERT INTO rentals (fromDate, toDate, weeklyRental) VALUES (?, ?, ?)", ['', '', 0]); this.render(); }
  addDeposit() { this.repo.run("INSERT INTO deposits (depositDate, description, amount) VALUES (?, ?, ?)", ['', '', 0]); this.render(); }

  persistContainer(containerId) {
    if (containerId === 'earning-container') {
      const rows = Array.from(document.querySelectorAll('.earning-row')).map(row => ({
        fromDate: row.querySelector('[name="fromDate"]').value,
        toDate: row.querySelector('[name="toDate"]').value,
        weeklyWage: Number(row.querySelector('[name="weeklyWage"]').value),
        weeklySpend: Number(row.querySelector('[name="weeklySpend"]').value)
      }));
      this.repo.saveEarnings(rows);
    } else if (containerId === 'purchase-container') {
      const rows = Array.from(document.querySelectorAll('.purchase-row')).map(row => ({
        id: crypto.randomUUID(),
        date: row.querySelector('[name="date"]').value,
        description: row.querySelector('[name="description"]').value,
        amount: Number(row.querySelector('[name="amount"]').value),
        include: row.querySelector('[name="includeFlag"]').checked
      }));
      this.repo.savePurchases(rows);
    } else if (containerId === 'rental-container') {
      const rows = Array.from(document.querySelectorAll('.rental-row')).map(row => ({
        fromDate: row.querySelector('[name="fromDate"]').value,
        toDate: row.querySelector('[name="toDate"]').value,
        weeklyRental: Number(row.querySelector('[name="weeklyRental"]').value)
      }));
      this.repo.saveRentals(rows);
    } else if (containerId === 'offset-deposit-container') {
      const rows = Array.from(document.querySelectorAll('.offset-row')).map(row => ({
        depositDate: row.querySelector('[name="depositDate"]').value,
        description: row.querySelector('[name="description"]').value,
        amount: Number(row.querySelector('[name="amount"]').value)
      }));
      this.repo.saveDeposits(rows);
    }
  }

  showPage(pageId) {
    this.state.currentPage = pageId;
    document.querySelectorAll('.app-page').forEach(el => el.style.display = 'none');
    document.getElementById(pageId).style.display = 'block';
  }

  updateStateFromDOM() {
    ['loanTerm', 'loanAmount', 'interestRate'].forEach(field => { const el = document.getElementById(field); if (el) this.state.loanSettings[field] = Number(el.value) || 0; });
    const el = document.getElementById('loanStartDate'); if (el) this.state.loanSettings.loanStartDate = el.value;
  }

  runWeeklyForecast() {
    const { loanAmount, interestRate, loanTerm } = this.state.loanSettings;
    if (!loanAmount || !loanTerm) return null;
    let balance = Number(loanAmount);
    let offset = 0;
    const results = [];
    const repayment = FinancialEngine.calculateWeeklyRepayment(loanAmount, interestRate, loanTerm);
    for (let week = 0; week < loanTerm * 52; week++) {
      const loanResult = FinancialEngine.calculateLoanWeek({ balance, offset, rate: interestRate, repayment });
      balance = loanResult.newBalance;
      results.push({ date: new Date(), balance, interest: loanResult.interest });
      if (balance <= 0) break;
    }
    return results;
  }

  render() {
    Object.keys(this.state.loanSettings).forEach(key => { const el = document.getElementById(key); if (el) el.value = this.state.loanSettings[key]; });
    this.renderEarnings(); this.renderPurchases(); this.renderRentals();
    const { loanAmount, interestRate, loanTerm } = this.state.loanSettings;
    if (loanAmount && interestRate && loanTerm) {
      document.getElementById('weeklyRepayment').value = FinancialEngine.calculateWeeklyRepayment(loanAmount, interestRate, loanTerm).toFixed(2);
      const forecast = this.runWeeklyForecast();
      const container = document.getElementById('forecast-container');
      if (container && forecast) container.innerHTML = `<h3>Simulation complete: ${forecast.length} weeks to payoff.</h3>`;
    }
  }

  renderEarnings() {
    const container = document.getElementById('earning-container');
    if (!container) return; container.innerHTML = '';
    this.repo.getEarnings().forEach(data => {
      const row = document.createElement('div'); row.className = 'earning-grid earning-row';
      row.innerHTML = `<div class="card"><input type="date" value="${data.fromDate}" class="save-trigger" name="fromDate"></div><div class="card"><input type="date" value="${data.toDate}" class="save-trigger" name="toDate"></div><div class="card"><input type="number" value="${data.weeklyWage}" class="save-trigger" name="weeklyWage"></div><div class="card"><input type="number" value="${data.weeklySpend}" class="save-trigger" name="weeklySpend"></div>`;
      container.appendChild(row);
    });
  }

  renderPurchases() {
    const container = document.getElementById('purchase-container');
    if (!container) return; container.innerHTML = '';
    let total = 0;
    this.repo.getPurchases().forEach(data => {
      if (data.includeFlag) total += data.amount;
      const row = document.createElement('div'); row.className = 'purchase-grid purchase-row';
      row.innerHTML = `<div class="card"><input type="date" value="${data.date}" class="save-trigger" name="date"></div><div class="card"><input type="text" value="${data.description}" class="save-trigger" name="description"></div><div class="card"><input type="number" value="${data.amount}" class="save-trigger" name="amount"></div><div class="card"><input type="checkbox" ${data.includeFlag ? 'checked' : ''} class="save-trigger" name="includeFlag"></div>`;
      container.appendChild(row);
    });
    const totalEl = document.getElementById('purchase-total');
    if (totalEl) totalEl.textContent = `$${total}`;
  }

  renderRentals() {
    const container = document.getElementById('rental-container');
    if (!container) return; container.innerHTML = '';
    this.repo.getRentals().forEach(data => {
      const row = document.createElement('div'); row.className = 'four-card-grid rental-row';
      row.innerHTML = `<div class="card"><input type="date" value="${data.fromDate}" class="save-trigger" name="fromDate"></div><div class="card"><input type="date" value="${data.toDate}" class="save-trigger" name="toDate"></div><div class="card"><input type="number" value="${data.weeklyRental}" class="save-trigger" name="weeklyRental"></div>`;
      container.appendChild(row);
    });
  }
}

const app = new CostProjectorApp();
app.start().catch(console.error);
