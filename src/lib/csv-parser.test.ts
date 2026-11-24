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
