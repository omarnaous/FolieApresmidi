import React from 'react';

/**
 * The store's size chart, under the size buttons on a product page. The owner
 * keeps one chart for the shop in the admin's settings; a size with no
 * measurements yet, and a measurement left blank for every size, are left off
 * rather than printed as gaps.
 */
export default function SizeChart({ chart, id }) {
  const filled = (v) => !!v?.trim();
  const rows = chart.rows.filter((r) => r.size.trim() && r.values.some(filled));
  const columns = chart.columns
    .map((name, i) => ({ name, i }))
    .filter(({ name, i }) => name.trim() && rows.some((r) => filled(r.values[i])));
  if (rows.length === 0 || columns.length === 0) return null;

  return (
    <div className="pdp-chart" id={id}>
      {chart.intro && <p className="pdp-chart-line">{chart.intro}</p>}
      <div className="pdp-chart-scroll">
        <table className="pdp-chart-table">
          <thead>
            <tr>
              <th scope="col">Size</th>
              {columns.map((c) => (
                <th scope="col" key={c.i}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.size}>
                <th scope="row">{r.size}</th>
                {columns.map((c) => (
                  <td key={c.i}>{filled(r.values[c.i]) ? r.values[c.i] : '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chart.note && <p className="pdp-chart-line">{chart.note}</p>}
    </div>
  );
}

/** Whether there is anything to show — the link only appears if there is. */
export const hasSizeChart = (chart) =>
  !!chart && chart.rows.some((r) => r.size.trim() && r.values.some((v) => v?.trim()));
