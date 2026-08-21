const results = JSON.parse(localStorage.getItem('forecastResults') || '[]');
const money = value => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const date = value => new Date(value).toISOString().slice(0, 10);
const fields = [
  row => row.weekNumber,
  row => date(row.weekDate),
  row => `${Number(row.rate || 0).toFixed(2)}%`,
  row => money(row.weeklyRental),
  row => money(row.purchases),
  row => money(row.weeklySpend),
  row => money(row.weeklyDeposits),
  row => money(row.interest),
  row => money(row.principal),
  row => money(row.repayment),
  row => money(row.loanBalance),
  row => money(row.offsetBalance),
  row => money(row.redrawAmount),
  row => money(row.gap),
];

document.getElementById('report-summary').textContent = `${results.length} weekly forecast results`;
document.getElementById('report-body').innerHTML = results.map(row => {
  const spendClass = row.actualSpend == null ? '' : row.actualSpend > row.forecastSpend ? 'spend-over' : row.actualSpend < row.forecastSpend ? 'spend-under' : '';
  const cells = fields.map((field, index) => `<td class="${index === 5 ? spendClass : ''}">${field(row)}</td>`).join('');
  return `<tr class="${Number(row.loanBalance) <= 0 ? 'loan-paid' : ''}">${cells}</tr>`;
}).join('');
document.getElementById('close-report').addEventListener('click', () => window.close());
