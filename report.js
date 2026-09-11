const results = JSON.parse(localStorage.getItem('forecastResults') || '[]');
const money = value => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const date = value => { const [year, month, day] = String(value).slice(0, 10).split('-').map(Number), months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${String(day).padStart(2, '0')}-${months[month - 1]}-${year}`; };
const isCurrentWeek = row => { const start = new Date(`${row.weekStart}T00:00:00`), end = new Date(start); end.setDate(start.getDate() + 7); return start <= new Date() && new Date() < end; };
const fields = [
  row => row.weekNumber,
  row => date(row.weekStart || row.weekDate),
  row => `${Number(row.rate || 0).toFixed(2)}%`,
  row => money(row.weeklyIncome),
  row => money(row.weeklyRental),
  row => money(Number(row.purchases || 0) - Number(row.weeklyDeposits || 0)),
  row => money(row.weeklySpend),
  row => row.weeklySurplus == null ? '—' : money(row.weeklySurplus),
  row => money(row.interest),
  row => money(row.principal),
  row => money(row.repayment),
  row => money(row.loanBalance),
  row => money(row.offsetBalance),
  row => money(row.redrawAmount),
  row => money(row.gap),
];

document.getElementById('report-summary').textContent = `${results.length} weekly forecast results`;
const elapsedWeeks = results.filter(row => new Date(`${row.weekStart}T00:00:00`) <= new Date());
document.getElementById('report-average-spent').textContent = `Average weekly spend from Week 1: ${money(elapsedWeeks.reduce((sum, row) => sum + Number(row.weeklySpend || 0), 0) / (elapsedWeeks.length || 1))}`;
document.getElementById('report-body').innerHTML = results.map(row => {
  const spendClass = row.actualSpend == null ? '' : row.actualSpend > row.forecastSpend ? 'spend-over' : row.actualSpend < row.forecastSpend ? 'spend-under' : '';
  const cells = fields.map((field, index) => `<td class="${index === 6 ? spendClass : ''}">${field(row)}</td>`).join('');
  return `<tr class="${isCurrentWeek(row) ? 'current-week' : Number(row.loanBalance) <= 0 ? 'loan-paid' : ''}">${cells}</tr>`;
}).join('');
document.getElementById('close-report').addEventListener('click', () => window.close());
