import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { parseMoumtazeFile } from '../lib/moumtaze-sync';

describe('moumtaze-sync', () => {
  it('correctly filters out admin orientation/results sheets and yields exactly 10 classes', async () => {
    const filePath = '/home/dzgeek/Downloads/2 A S    MOUMTAZE   2024-2025.xlsx';
    if (!fs.existsSync(filePath)) {
      return;
    }
    const buf = fs.readFileSync(filePath);
    const file = new File([buf], '2 A S    MOUMTAZE   2024-2025.xlsx');
    const result = await parseMoumtazeFile(file);

    expect(result.classes.length).toBe(10);

    const classNames = result.classes.map(c => c.className);
    console.log('Parsed class names:', classNames);

    // Verify all class names are unique
    const uniqueNames = new Set(classNames);
    expect(uniqueNames.size).toBe(10);

    // Verify no orientation sheet (sheetName "آداب" with 102 students) is included
    expect(result.classes.some(c => c.sheetName === 'آداب')).toBe(false);

    // Verify 2ر is recognized as 2AS
    const mathClass = result.classes.find(c => c.sheetName === '2ر');
    expect(mathClass).toBeDefined();
    expect(mathClass?.level).toBe('2AS');
    expect(mathClass?.className).toBe('2 رياضيات 1');

    // Total students across the 10 real classes (excluding summary/footer rows)
    const totalStudents = result.classes.reduce((sum, c) => sum + c.students.length, 0);
    expect(totalStudents).toBe(307);
  });
});
