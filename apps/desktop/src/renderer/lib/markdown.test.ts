import { describe, it, expect } from 'vitest'
import { renderMarkdown, docNameFromLink } from './markdown'

describe('renderMarkdown', () => {
  it('escapes anything that is not markup, so a guide cannot inject HTML or script', () => {
    const html = renderMarkdown('# Hi <img src=x onerror=alert(1)>\n\n<script>alert(1)</script> & "quotes"')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })
  it('only turns http(s) and mailto addresses into links, never javascript: or file:', () => {
    const html = renderMarkdown('[a](https://example.com) [b](javascript:alert(1)) [c](file:///etc/passwd) [d](mailto:x@y.z)')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer noopener">a</a>')
    expect(html).toContain('href="mailto:x@y.z"')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('file:')
  })
  it('links to other guides become in-app links', () => {
    expect(renderMarkdown('[more](OTHER.md#part)')).toContain('data-doc="OTHER"')
    expect(docNameFromLink('../docs/guides/X.md')).toBe('guides/X')
    expect(docNameFromLink('https://x.y')).toBeNull()
  })
  it('renders headings, lists, code, tables and quotes', () => {
    const html = renderMarkdown('## Title\n\n- one\n- two\n\n1. a\n2. b\n\n```\ncode <b>\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quoted')
    expect(html).toContain('<h2 id="title">Title</h2>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<ol><li>a</li><li>b</li></ol>')
    expect(html).toContain('<pre><code>code &lt;b&gt;</code></pre>')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<blockquote>')
  })
  it('renders the real getting-started guide without leaving raw markup behind', async () => {
    const fs = await import('node:fs')
    const md = fs.readFileSync(new URL('../../../../../docs/guides/GETTING_STARTED.md', import.meta.url), 'utf8')
    const html = renderMarkdown(md)
    expect(html).toContain('<h1')
    expect(html).not.toMatch(/\*\*[^*]+\*\*/) // no unconverted bold
    expect(html).not.toContain('```')
  })
})
