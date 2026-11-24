import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv-parser';

describe('CSV header collisions', () => {
  it('retains every value when duplicate names collide with existing suffixes', () => {
    const result = parseCsv('Name,Name,Name_2,Name,Name_3\nAda,Grace,Katherine,Barbara,Joan');
    expect(result.headers).toEqual(['Name', 'Name_4', 'Name_2', 'Name_5', 'Name_3']);
    expect(result.data).toEqual([{
      Name: 'Ada', Name_4: 'Grace', Name_2: 'Katherine', Name_5: 'Barbara', Name_3: 'Joan',
    }]);
  });

  it('preserves a literal __proto__ header as an ordinary CSV field', () => {
    const { data } = parseCsv('__proto__,Name\nValue,Ada');
    expect(Object.hasOwn(data[0], '__proto__')).toBe(true);
    expect(data[0].__proto__).toBe('Value');
    expect(Object.getPrototypeOf(data[0])).toBe(Object.prototype);
  });
});

describe('CSV record review', () => {
  it('keeps source record numbers through quoted newlines, empty records and exact duplicates', () => {
    const result = parseCsv('Name,Course\r\nAda,"First\r\nSecond"\r\n,\r\n" "," "\r\nAda,"First\r\nSecond"\r\nGrace,Math\r\n');
    expect(result.data).toEqual([{ Name: 'Ada', Course: 'First\r\nSecond' }, { Name: 'Grace', Course: 'Math' }]);
    expect(result.review.numbers).toEqual([2, 6]);
    expect(result.review.ignored).toEqual([{ number: 3 }, { number: 4 }, { number: 5, duplicateOf: 2 }]);
  });

  it('retains extra values for review and reports ambiguous header renames', () => {
    const result = parseCsv('Name,Name,,Course\nAda,Ada,,History\nAda,Ada,,History,2026\nAda,Ada,,History,2027');
    expect(result.data).toHaveLength(3);
    expect(result.review.extraColumns).toEqual([3, 4]);
    expect(result.review.renamedHeaders).toEqual([
      { column: 2, name: 'Name', header: 'Name_2' }, { column: 3, name: '', header: 'Column_3' },
    ]);
    expect(result.data.map((row) => row['Extra CSV values'])).toEqual(['', '["2026"]', '["2027"]']);
  });
});
