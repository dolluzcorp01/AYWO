import { describe, expect, it } from 'vitest';
import { countsAsLiving, parseGedcomDate, readGedcom, writeGedcom } from './index.ts';
import type { GedcomData, GedcomParentLink, GedcomPerson, GedcomUnion } from './index.ts';

// A made-up family. Real names stay out of the repo.
const FILE_551 = [
  '0 HEAD',
  '1 SOUR Test',
  '1 GEDC',
  '2 VERS 5.5.1',
  '2 FORM LINEAGE-LINKED',
  '1 CHAR UTF-8',
  '1 FILE Sample family.ged',
  '0 @I1@ INDI',
  '1 NAME Arul /Kannan/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE ABT 1930',
  '2 PLAC Madurai',
  '1 DEAT',
  '2 DATE 5 MAR 1999',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Bama /Devi/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE BEF 1935',
  '1 NOTE First line',
  '2 CONT second line',
  '2 CONC  joined',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Chitra /Kannan/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE JUN 1960',
  '1 FAMC @F1@',
  '0 @I4@ INDI',
  '1 NAME Dev /Kannan/',
  '1 BIRT',
  '2 DATE 1962',
  '1 FAMC @F1@',
  '2 PEDI adopted',
  '1 OBJE',
  '2 FILE C:\\photos\\dev.jpg',
  '0 @I5@ INDI',
  '1 NAME //',
  '1 NOTE @N1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 MARR',
  '2 DATE 2 FEB 1955',
  '1 DIV',
  '1 CHIL @I3@',
  '1 CHIL @I4@',
  '0 @F2@ FAM',
  '1 HUSB @I3@',
  '1 CHIL @I5@',
  '1 CHIL @I99@',
  '0 @N1@ NOTE Kept in a record',
  '0 TRLR',
].join('\n');

const FILE_70 = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @X1@ INDI',
  '1 NAME Elan /Raja/',
  '2 GIVN Elan',
  '1 SEX X',
  '1 BIRT',
  '2 DATE BET 1900 AND 1905',
  '1 SNOTE @S1@',
  '0 @X2@ INDI',
  '1 NAME',
  '2 GIVN Fathima',
  '2 SURN Noor',
  '1 SEX F',
  '1 BIRT',
  '2 DATE JULIAN 1699',
  '0 @X3@ INDI',
  '1 NAME Guna',
  '1 FAMC @Y1@',
  '0 @Y1@ FAM',
  '1 HUSB @VOID@',
  '1 WIFE @X2@',
  '1 CHIL @X3@',
  '0 @S1@ SNOTE Shared note',
  '0 TRLR',
].join('\r\n');

function asPeople(list: unknown): GedcomPerson[] {
  return list as GedcomPerson[];
}

function byName(list: unknown, name: string): GedcomPerson {
  const found = asPeople(list).find((p) => p.displayName === name);
  if (!found) throw new Error('nobody called ' + name);
  return found;
}

/** Turns a preview into what the database would hold, with temp ids replaced by names. */
function shape(text: string): { people: string[]; couples: string[]; links: string[] } {
  const preview = readGedcom(text);
  const nameOf: Map<string, string> = new Map();
  for (const p of preview.persons) nameOf.set(p.tempId, p.displayName);
  return {
    people: preview.persons.map((p) => p.displayName).sort(),
    couples: preview.unions.map((u) => [nameOf.get(u.partner1Id), nameOf.get(u.partner2Id)].sort().join(' + ')).sort(),
    links: preview.parentLinks.map((l) => nameOf.get(l.parentId) + ' > ' + nameOf.get(l.childId)).sort(),
  };
}

/** Builds export rows straight from a preview, standing in for the database in the round trip. */
function toRows(text: string): GedcomData {
  const preview = readGedcom(text);
  const people = asPeople(preview.persons);
  return {
    treeName: preview.mapName,
    persons: people.map((p) => ({
      id: p.tempId,
      display_name: p.displayName,
      name_unknown: p.nameUnknown,
      note_label: p.noteLabel,
      gender: p.gender,
      living: p.living,
      birth_date: p.birthDate,
      birth_precision: p.birthPrecision,
      birth_place: p.birthPlace,
      death_date: p.deathDate,
      death_precision: p.deathPrecision,
      death_place: p.deathPlace,
      birth_order: p.birthOrder,
      notes: p.notes,
    })),
    unions: (preview.unions as GedcomUnion[]).map((u) => ({
      id: u.tempId,
      partner1_id: u.partner1Id,
      partner2_id: u.partner2Id,
      kind: u.kind,
      status: u.status,
      start_date: u.startDate,
      end_date: u.endDate,
    })),
    links: (preview.parentLinks as GedcomParentLink[]).map((l) => ({
      parent_id: l.parentId,
      child_id: l.childId,
      union_id: l.unionId,
      kind: l.kind,
    })),
  };
}

describe('readGedcom 5.5.1', () => {
  const preview = readGedcom(FILE_551);

  it('gives the same preview shape as Lighten', () => {
    expect(preview.mapName).toBe('Sample family');
    expect(preview.counts.people).toBe(5);
    expect(preview.counts.couples).toBe(1);
    expect(preview.counts.generations).toBe(3);
    expect(preview.placeholders).toEqual([]);
    expect(preview.merges).toEqual([]);
  });

  it('reads names and turns an empty one into Name unknown', () => {
    expect(byName(preview.persons, 'Arul Kannan').gender).toBe('male');
    const unknown = byName(preview.persons, 'Name unknown');
    expect(unknown.nameUnknown).toBe(true);
    expect(unknown.notes).toBe('Kept in a record');
  });

  it('keeps date precision', () => {
    const arul = byName(preview.persons, 'Arul Kannan');
    expect(arul.birthDate).toBe('1930-01-01');
    expect(arul.birthPrecision).toBe('about');
    expect(arul.birthDateText).toBe('ABT 1930');
    expect(arul.deathDate).toBe('1999-03-05');
    expect(arul.deathPrecision).toBe('exact');
    expect(arul.living).toBe('deceased');
    const bama = byName(preview.persons, 'Bama Devi');
    expect(bama.birthPrecision).toBe('about');
    expect(bama.birthDateText).toBe('BEF 1935');
    expect(byName(preview.persons, 'Chitra Kannan').birthPrecision).toBe('month');
    expect(byName(preview.persons, 'Chitra Kannan').birthDate).toBe('1960-06-01');
    expect(byName(preview.persons, 'Dev Kannan').birthPrecision).toBe('year');
  });

  it('joins CONT and CONC, and takes the file name from an OBJE path', () => {
    expect(byName(preview.persons, 'Bama Devi').notes).toBe('First line\nsecond line joined');
    expect(byName(preview.persons, 'Dev Kannan').photoFile).toBe('dev.jpg');
  });

  it('reads families, link kinds and divorce', () => {
    const union = preview.unions[0] as GedcomUnion;
    expect(union.kind).toBe('marriage');
    expect(union.status).toBe('divorced');
    expect(union.startDate).toBe('1955-02-02');
    const toDev = (preview.parentLinks as GedcomParentLink[]).filter((l) => l.childId === '@I4@');
    expect(toDev).toHaveLength(2);
    expect(toDev[0].kind).toBe('adopted');
    expect(toDev[0].unionId).toBe(union.tempId);
  });

  it('guesses a gender from the family and flags it for checking', () => {
    expect(byName(preview.persons, 'Dev Kannan').gender).toBe('unknown');
    const file = FILE_551.replace('1 NAME Arul /Kannan/\n1 SEX M', '1 NAME Arul /Kannan/');
    const arul = byName(readGedcom(file).persons, 'Arul Kannan');
    expect(arul.gender).toBe('male');
    expect(arul.genderGuessed).toBe(true);
  });

  it('a lone parent has a link but no couple', () => {
    const toFive = preview.parentLinks.filter((l) => l.childId === '@I5@');
    expect(toFive).toHaveLength(1);
    expect(toFive[0].unionId).toBeNull();
  });

  it('reports a pointer to nobody without failing', () => {
    expect(preview.problems.some((p) => p.code === 'gedcom_link_not_matched' && p.detail.includes('@I99@'))).toBe(true);
  });
});

describe('readGedcom 7.0', () => {
  const preview = readGedcom(FILE_70);

  it('reads the 7.0 forms', () => {
    const elan = byName(preview.persons, 'Elan Raja');
    expect(elan.gender).toBe('other');
    expect(elan.birthDate).toBe('1900-01-01');
    expect(elan.birthPrecision).toBe('about');
    expect(elan.notes).toBe('Shared note');
    expect(byName(preview.persons, 'Fathima Noor').gender).toBe('female');
  });

  it('keeps a date in another calendar as words, and says so', () => {
    const person = byName(preview.persons, 'Fathima Noor');
    expect(person.birthDate).toBeNull();
    expect(person.birthDateText).toBe('JULIAN 1699');
    expect(preview.problems.some((p) => p.code === 'gedcom_date_not_understood')).toBe(true);
  });

  it('treats @VOID@ as nobody, without a problem', () => {
    expect(preview.unions).toHaveLength(0);
    expect(preview.parentLinks).toHaveLength(1);
    expect(preview.problems.some((p) => p.code === 'gedcom_link_not_matched')).toBe(false);
  });
});

describe('bad files', () => {
  it('throws on something that is not a GEDCOM file, so the upload says import_bad_file', () => {
    expect(() => readGedcom('hello there')).toThrow();
    expect(() => readGedcom('')).toThrow();
  });

  it('skips a broken line and carries on', () => {
    const preview = readGedcom('0 HEAD\nnot a line\n0 @I1@ INDI\n1 NAME Ila\n0 TRLR\n');
    expect(preview.persons).toHaveLength(1);
    expect(preview.problems.some((p) => p.code === 'gedcom_bad_line')).toBe(true);
  });

  it('drops a family loop instead of failing the import later', () => {
    const file = [
      '0 HEAD',
      '0 @A@ INDI',
      '1 NAME Anbu',
      '0 @B@ INDI',
      '1 NAME Balu',
      '0 @F1@ FAM',
      '1 HUSB @A@',
      '1 CHIL @B@',
      '0 @F2@ FAM',
      '1 HUSB @B@',
      '1 CHIL @A@',
      '0 TRLR',
    ].join('\n');
    const preview = readGedcom(file);
    expect(preview.parentLinks).toHaveLength(1);
    expect(preview.problems.some((p) => p.code === 'gedcom_family_loop')).toBe(true);
  });

  it('never repeats a parent and child pair, which the database would refuse', () => {
    const file = ['0 HEAD', '0 @A@ INDI', '1 NAME Anbu', '0 @B@ INDI', '1 NAME Balu', '0 @F1@ FAM', '1 HUSB @A@', '1 CHIL @B@', '1 CHIL @B@', '0 TRLR'].join('\n');
    expect(readGedcom(file).parentLinks).toHaveLength(1);
  });

  it('flags a file that is not UTF-8', () => {
    const preview = readGedcom('0 HEAD\n1 CHAR ANSEL\n0 TRLR');
    expect(preview.problems.some((p) => p.code === 'gedcom_not_utf8')).toBe(true);
  });
});

describe('parseGedcomDate', () => {
  it('handles the forms in L8.1', () => {
    expect(parseGedcomDate('12 JAN 1950').precision).toBe('exact');
    expect(parseGedcomDate('12 JAN 1950').date).toBe('1950-01-12');
    expect(parseGedcomDate('JAN 1950').precision).toBe('month');
    expect(parseGedcomDate('1950').precision).toBe('year');
    expect(parseGedcomDate('AFT 1950').precision).toBe('about');
    expect(parseGedcomDate('FROM 1950 TO 1960').date).toBe('1950-01-01');
    expect(parseGedcomDate('1699/00').date).toBe('1699-01-01');
  });

  it('refuses dates that do not exist, which the database would also refuse', () => {
    expect(parseGedcomDate('31 FEB 1950').date).toBeNull();
    expect(parseGedcomDate('29 FEB 1900').date).toBeNull();
    expect(parseGedcomDate('29 FEB 2000').date).toBe('2000-02-29');
    expect(parseGedcomDate('(about harvest time)').date).toBeNull();
    expect(parseGedcomDate('100 BCE').date).toBeNull();
    expect(parseGedcomDate(null).text).toBeNull();
  });
});

describe('writeGedcom', () => {
  const data: GedcomData = {
    treeName: 'Test tree',
    persons: [
      { id: 'dad', display_name: 'Old Parent', gender: 'male', living: 'deceased', birth_date: '1920-05-01', birth_precision: 'exact', death_date: '1990-01-01', death_precision: 'year' },
      { id: 'mum', display_name: 'Living Elder', gender: 'female', living: 'living', birth_date: '1945-03-09', birth_precision: 'exact', birth_place: 'Salem', notes: 'A private note' },
      { id: 'kid', display_name: 'Young Person', gender: 'other', living: 'unknown', birth_date: '1980-07-01', birth_precision: 'month' },
      { id: 'ancient', display_name: 'Long Gone', gender: 'unknown', living: 'unknown', birth_date: '1800-01-01', birth_precision: 'year' },
    ],
    unions: [{ id: 'u1', partner1_id: 'dad', partner2_id: 'mum', kind: 'marriage', status: 'current', start_date: '1965-02-03' }],
    links: [
      { parent_id: 'dad', child_id: 'kid', union_id: 'u1', kind: 'birth' },
      { parent_id: 'mum', child_id: 'kid', union_id: 'u1', kind: 'birth' },
    ],
  };

  it('writes a 5.5.1 UTF-8 file with a head and a trailer', () => {
    const out = writeGedcom(data, { includeLiving: false });
    expect(out.startsWith('0 HEAD\r\n')).toBe(true);
    expect(out).toContain('2 VERS 5.5.1');
    expect(out).toContain('1 CHAR UTF-8');
    expect(out).toContain('1 FILE Test tree.ged');
    expect(out.trim().endsWith('0 TRLR')).toBe(true);
    expect(out).not.toContain('dad');
  });

  it('leaves out living details unless ticked', () => {
    const out = writeGedcom(data, { includeLiving: false });
    expect(out).toContain('Living Elder');
    expect(out).not.toContain('1945');
    expect(out).not.toContain('Salem');
    expect(out).not.toContain('A private note');
    expect(out).not.toContain('1980');
    // The couple's date would give a living person away too.
    expect(out).not.toContain('1965');
    expect(out).toContain('1 BIRT\r\n2 DATE 1 MAY 1920');
    expect(out).toContain('2 DATE 1800');
  });

  it('includes them when ticked', () => {
    const out = writeGedcom(data, { includeLiving: true });
    expect(out).toContain('2 DATE 9 MAR 1945');
    expect(out).toContain('2 PLAC Salem');
    expect(out).toContain('1 NOTE A private note');
    expect(out).toContain('2 DATE JUL 1980');
    expect(out).toContain('2 DATE 3 FEB 1965');
  });

  it('counts anyone not clearly dead as living', () => {
    const today = new Date(Date.UTC(2026, 10, 2));
    expect(countsAsLiving(data.persons[0], today)).toBe(false);
    expect(countsAsLiving(data.persons[1], today)).toBe(true);
    expect(countsAsLiving(data.persons[2], today)).toBe(true);
    expect(countsAsLiving(data.persons[3], today)).toBe(false);
    expect(countsAsLiving({ id: 'x', display_name: 'No Dates', gender: 'unknown', living: 'unknown' }, today)).toBe(true);
  });

  it('escapes @ and breaks long text, and reads both back', () => {
    const long = 'word '.repeat(120).trim();
    const out = writeGedcom(
      {
        persons: [{ id: 'a', display_name: 'Mail Person', gender: 'unknown', living: 'deceased', notes: 'see a@b\nsecond line ' + long }],
        unions: [],
        links: [],
      },
      { includeLiving: true },
    );
    for (const line of out.split('\r\n')) expect(line.length).toBeLessThan(255);
    expect(out).toContain('a@@b');
    const back = asPeople(readGedcom(out).persons)[0];
    expect(back.notes).toBe('see a@b\nsecond line ' + long);
  });

  it('keeps Tamil text whole', () => {
    const name = 'அருள் கண்ணன்';
    const out = writeGedcom({ persons: [{ id: 'a', display_name: name, gender: 'male', living: 'living' }], unions: [], links: [] }, { includeLiving: false });
    expect(asPeople(readGedcom(out).persons)[0].displayName).toBe(name);
  });

  it('does not make a parent of the partner who is not one', () => {
    const out = writeGedcom(
      {
        persons: [
          { id: 'a', display_name: 'Step Father', gender: 'male', living: 'deceased' },
          { id: 'b', display_name: 'Real Mother', gender: 'female', living: 'deceased' },
          { id: 'c', display_name: 'Only Child', gender: 'female', living: 'deceased' },
        ],
        unions: [{ id: 'u', partner1_id: 'a', partner2_id: 'b' }],
        links: [{ parent_id: 'b', child_id: 'c', union_id: 'u', kind: 'birth' }],
      },
      { includeLiving: true },
    );
    const shaped = shape(out);
    expect(shaped.links).toEqual(['Real Mother > Only Child']);
    expect(shaped.couples).toEqual(['Real Mother + Step Father']);
  });
});

describe('T-IO-02: import, export, re-import', () => {
  it('gives the same people and relationships', () => {
    const first = shape(FILE_551);
    const written = writeGedcom(toRows(FILE_551), { includeLiving: true });
    expect(shape(written)).toEqual(first);
    // And a second time round: the file settles.
    const again = writeGedcom(toRows(written), { includeLiving: true });
    expect(shape(again)).toEqual(first);
  });

  it('keeps the details too when living details are ticked', () => {
    const written = writeGedcom(toRows(FILE_551), { includeLiving: true });
    const back = readGedcom(written);
    const arul = byName(back.persons, 'Arul Kannan');
    expect(arul.birthDate).toBe('1930-01-01');
    expect(arul.birthPrecision).toBe('about');
    expect(arul.deathDate).toBe('1999-03-05');
    expect(arul.living).toBe('deceased');
    expect(byName(back.persons, 'Bama Devi').notes).toBe('First line\nsecond line joined');
    expect(byName(back.persons, 'Bama Devi').gender).toBe('female');
    expect(byName(back.persons, 'Name unknown').nameUnknown).toBe(true);
    const toDev = (back.parentLinks as GedcomParentLink[]).filter((l) => {
      const person = asPeople(back.persons).find((p) => p.tempId === l.childId);
      return person !== undefined && person.displayName === 'Dev Kannan';
    });
    expect(toDev[0].kind).toBe('adopted');
    const union = back.unions[0] as GedcomUnion;
    expect(union.status).toBe('divorced');
    expect(union.startDate).toBe('1955-02-02');
  });

  it('keeps the people and relationships even with living details left out', () => {
    const written = writeGedcom(toRows(FILE_551), { includeLiving: false });
    expect(shape(written)).toEqual(shape(FILE_551));
  });

  it('keeps a person gender other, a label and a birth order', () => {
    const out = writeGedcom(
      {
        persons: [{ id: 'a', display_name: 'Tara', gender: 'other', living: 'deceased', note_label: 'Second Wife', birth_order: 2 }],
        unions: [],
        links: [],
      },
      { includeLiving: true },
    );
    const back = asPeople(readGedcom(out).persons)[0];
    expect(back.gender).toBe('other');
    expect(back.noteLabel).toBe('Second Wife');
    expect(back.birthOrder).toBe(2);
  });
});
