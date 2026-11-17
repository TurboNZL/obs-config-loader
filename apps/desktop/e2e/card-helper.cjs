// A preset tile. Its manager popup is drawn outside the tile (so it is never clipped by the card), so
// anything searched for INSIDE the card is also looked for in that preset's open popup.
module.exports = (page, sel = (n) => `section.card:has(h2:text-is("${n}"))`) => (name) => {
  const tile = page.locator(sel(name))
  const dlg = page.locator(`div[role="dialog"][aria-label="Manage ${name}"], div[role="dialog"][aria-label="Export ${name}"]`)
  return new Proxy(tile, {
    get(t, k) {
      if (k === 'innerText' || k === 'textContent') return async () => (await t[k]()) + '\n' + (await dlg.count() ? (await dlg.allInnerTexts()).join('\n') : '')
      if (k === 'locator') return (sel, o) => t.locator(sel, o).or(dlg.locator(sel, o))
      const v = Reflect.get(t, k, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}
