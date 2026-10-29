import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { conversionOptions, convert } from '../src/services/convert/index.js';
import { formatOf } from '../src/services/formats.js';

// Builds a small sample of each input type, runs every built-in conversion offered for it,
// and checks that the output really is the promised type (by its first bytes).

const samples: Record<string, Buffer> = {};

beforeAll(async () => {
  samples.png = await sharp({ create: { width: 120, height: 80, channels: 4, background: { r: 79, g: 70, b: 229, alpha: 0.5 } } }).png().toBuffer();
  samples.jpg = await sharp(samples.png).flatten({ background: '#fff' }).jpeg().toBuffer();
  samples.webp = await sharp(samples.png).webp().toBuffer();
  samples.gif = await sharp(samples.png).gif().toBuffer();
  samples.svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#4f46e5"/></svg>');
  samples.txt = Buffer.from('Birth Certificate\n\nName: Priya Lakshmi\nபெயர்: பிரியா லட்சுமி\n\n' + 'Long paragraph. '.repeat(400));
  samples.md = Buffer.from('# Title\n\nSome text.\n\n## Section\n\nMore text.');
  samples.csv = Buffer.from('Name,Age,District\n"Ravi, K",30,Chennai\nபிரியா,25,மதுரை\n=1+1,0042,Salem\n');
  samples.json = Buffer.from(JSON.stringify([{ Name: 'Ravi', Age: 30 }, { Name: 'Priya', District: 'Madurai' }]));
  samples.html = Buffer.from('<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Hi</h1><p>Hello &amp; welcome</p></body></html>');
  // Inputs made by the converters themselves: a 2-page PDF, a Word file and an Excel file.
  samples.pdf = (await convert(Buffer.from('Page one\n\n' + 'Filler line.\n'.repeat(120) + '\n\nEnd'), 'txt', 'pdf', 'Sample')).data;
  samples.docx = (await convert(samples.md, 'md', 'docx', 'Sample')).data;
  samples.xlsx = (await convert(samples.csv, 'csv', 'xlsx', 'Sample')).data;
}, 60_000);

const OUTPUT_EXT: Record<string, string> = { jpeg: 'jpg' };

describe('built-in conversions', () => {
  for (const from of ['png', 'jpg', 'webp', 'gif', 'svg', 'txt', 'md', 'csv', 'json', 'html', 'pdf', 'docx', 'xlsx']) {
    it(`converts ${from} to every offered built-in format`, async () => {
      const options = conversionOptions(from).filter((o) => o.engine === 'built-in');
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        const result = await convert(samples[from], from, option.to, 'Sample');
        const expected = result.ext === 'zip' ? 'zip' : (OUTPUT_EXT[option.to] ?? option.to);
        expect(result.ext, `${from} -> ${option.to}`).toBe(expected);
        expect(result.data.length, `${from} -> ${option.to} is empty`).toBeGreaterThan(0);
        expect(formatOf(result.ext)!.matches(result.data), `${from} -> ${option.to} has the wrong content`).toBe(true);
      }
    }, 60_000);
  }

  it('turns a multi-page PDF into a ZIP of page images', async () => {
    const result = await convert(samples.pdf, 'pdf', 'png', 'Sample');
    expect(result.ext).toBe('zip');
  });

  it('keeps Tamil text and blocks spreadsheet formulas in CSV output', async () => {
    const json = JSON.parse((await convert(samples.csv, 'csv', 'json', 'Sample')).data.toString('utf8'));
    expect(json[1].Name).toBe('பிரியா');
    const csv = (await convert(samples.xlsx, 'xlsx', 'csv', 'Sample')).data.toString('utf8');
    expect(csv).toContain("'=1+1");
    expect(csv).toContain('பிரியா');
  });

  it('drops scripts when turning HTML into text', async () => {
    const text = (await convert(samples.html, 'html', 'txt', 'Sample')).data.toString('utf8');
    expect(text).toContain('Hello & welcome');
    expect(text).not.toContain('alert');
  });

  it('refuses conversions that do not exist', async () => {
    await expect(convert(samples.csv, 'csv', 'png', 'Sample')).rejects.toThrow(/cannot be converted/);
    expect(conversionOptions('zip')).toEqual([]);
  });
});
