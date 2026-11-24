import { describe, expect, it } from 'vitest';
import { freezeRenderFields } from './render-fields';

describe('freezeRenderFields', () => {
  it('keeps the values printed at issuance and excludes private columns', () => {
    const layout = { boxes: [{ field: 'Name' }, { field: 'Course' }] };
    const row = { Name: 'Ada', Course: 'CS', 'Internal Note': 'Private' };
    const fields = freezeRenderFields(layout, row);
    row.Name = 'Changed';
    layout.boxes.push({ field: 'Internal Note' });
    expect(fields).toEqual({ Name: 'Ada', Course: 'CS' });
  });

  it('stores only the selected value when the row contains competing aliases', () => {
    const row = { 'Full Name': 'Ada', 'Student Name': 'Private', Mail: 'ada@example.test' };
    expect(freezeRenderFields({ boxes: [{ field: 'Recipient Name' }, { field: 'Email' }] }, row))
      .toEqual({ 'Recipient Name': 'Ada', Email: 'ada@example.test' });
  });

  it('preserves a blank and ignores field bindings on static boxes', () => {
    expect(freezeRenderFields({
      boxes: [{ field: 'Course' }, { field: 'Hidden', kind: 'static' }, { field: '' }],
    }, { Hidden: 'Never printed' })).toEqual({ Course: '' });
  });

  it('treats inherited object members as absent data', () => {
    expect(freezeRenderFields({ boxes: [{ field: '__proto__' }, { field: 'constructor' }] }, {}))
      .toEqual(Object.fromEntries([['__proto__', ''], ['constructor', '']]));
  });

  it('retains literal prototype-like headers provided by the roster', () => {
    const row = Object.fromEntries([['__proto__', 'A real column']]);
    expect(Object.hasOwn(freezeRenderFields({ boxes: [{ field: '__proto__' }] }, row), '__proto__')).toBe(true);
  });
});
