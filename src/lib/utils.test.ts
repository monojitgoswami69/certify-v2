import { describe, it, expect } from 'vitest';
import { csvCell, escapeHtml, replaceTemplateVariables, sanitizeFilename } from './utils';

describe('csvCell (formula injection defense)', () => {
  it('quote-wraps and escapes quotes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
  });

  it("prefixes cells that Excel/LibreOffice would execute as formulas", () => {
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"'
    );
    expect(csvCell('+1|cmd')).toBe('"\'+1|cmd"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
    expect(csvCell('@SUM(A1)').startsWith('"\'@SUM')).toBe(true);
  });

  it('leaves ordinary values untouched', () => {
    expect(csvCell('Johnny Smith')).toBe('"Johnny Smith"');
    expect(csvCell('x@y.com')).toBe('"x@y.com"');
    expect(csvCell('2026-10-25')).toBe('"2026-10-25"');
  });
});

describe('replaceTemplateVariables', () => {
  const data = { Name: 'Ada <Lovelace>', email: 'ada@example.com' };

  it('substitutes exact and fuzzy keys', () => {
    expect(replaceTemplateVariables('Hi {{Name}}', data)).toBe('Hi Ada <Lovelace>');
    expect(replaceTemplateVariables('Hi {{ name }}', data)).toBe('Hi Ada <Lovelace>');
    expect(replaceTemplateVariables('{{EMAIL}}', data)).toBe('ada@example.com');
  });

  it('HTML-escapes untrusted values in html mode', () => {
    expect(replaceTemplateVariables('<b>{{Name}}</b>', data, { html: true })).toBe(
      '<b>Ada &lt;Lovelace&gt;</b>'
    );
  });

  it('leaves unknown placeholders alone', () => {
    expect(replaceTemplateVariables('{{Missing}}', data)).toBe('{{Missing}}');
  });
});

describe('sanitizeFilename', () => {
  it('strips path separators and windows-reserved names', () => {
    // Slashes are stripped; dots are legal filename characters and survive.
    expect(sanitizeFilename('../../etc/passwd')).toBe('....etcpasswd');
    expect(sanitizeFilename('CON')).toBe('CON_file'); // reserved name gets a suffix
    expect(sanitizeFilename('')).toBe('certificate');
    expect(sanitizeFilename('Report*.pdf')).toBe('Report.pdf');
  });
});

describe('escapeHtml', () => {
  it('escapes all five dangerous characters', () => {
    expect(escapeHtml(`<a href="x" class='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    );
  });
});
