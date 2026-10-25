import { describe, it, expect } from 'vitest';
import { pickRenderFields } from './render-fields';

describe('pickRenderFields (public asset field filter)', () => {
  const layout = { boxes: [{ field: 'Name' }, { field: 'Course' }] };

  it('returns only fields referenced by template boxes', () => {
    const row = { Name: 'Ada', Course: 'CS', 'Internal Notes': 'salary=low', Phone: '555' };
    expect(pickRenderFields(row, layout)).toEqual({ Name: 'Ada', Course: 'CS' });
  });

  it('matches case-insensitively and ignores whitespace/punctuation in keys', () => {
    const row = { 'FULL NAME': 'Ada', course_code: 'CS101' };
    const layout2 = { boxes: [{ field: 'Full Name' }, { field: 'Course Code' }] };
    expect(pickRenderFields(row, layout2)).toEqual({ 'FULL NAME': 'Ada', course_code: 'CS101' });
  });

  it('expands alias groups so resolveFieldValue finds its data on the client', () => {
    const row = { 'Student Name': 'Ada' };
    const layout3 = { boxes: [{ field: 'Recipient Name' }] };
    expect(pickRenderFields(row, layout3)).toEqual({ 'Student Name': 'Ada' });

    const emailRow = { Mail: 'a@b.c' };
    expect(pickRenderFields(emailRow, { boxes: [{ field: 'email' }] })).toEqual({ Mail: 'a@b.c' });
  });

  it('returns empty for null/missing inputs and empty boxes', () => {
    expect(pickRenderFields(null, layout)).toEqual({});
    expect(pickRenderFields({ Name: 'x' }, null)).toEqual({});
    expect(pickRenderFields({ Name: 'x' }, { boxes: [] })).toEqual({});
    expect(pickRenderFields({ Name: 'x' }, { boxes: [{ field: '' }] })).toEqual({});
  });

  it('never leaks unreferenced PII even when keys look similar', () => {
    const row = { Name: 'Ada', NameOfGuardian: 'Bob', EmailAddress2: 'side@b.c' };
    expect(pickRenderFields(row, { boxes: [{ field: 'Name' }, { field: 'email' }] })).toEqual({
      Name: 'Ada',
    });
  });
});
