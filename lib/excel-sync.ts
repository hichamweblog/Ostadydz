import {
  resolveEffectiveScheme,
  type EducationOverrides,
  type LevelCode,
  type StreamId,
  type SubjectId,
  type VariantId,
} from './education';
import { calculateContinuousEval, getObservation, resolveDevoirAverage } from './grade-calculator';
import {
  areNamesMatching,
  detectSubjectFromRakmanaHeader,
  extractGroupNumber,
  normalizeArabicText,
  parseClassDescriptorToLevelAndStream,
} from './name-normalizer';
import {
  mapLevelAndStreamToLegacyGradeLevel,
  type GradeLevel,
  type Student,
  type StudentGrade,
  type Term,
} from './types';

export const MAX_EXCEL_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_EXCEL_SHEETS = 40;
export const MAX_EXCEL_ROWS_TOTAL = 20_000;
export const MAX_EXCEL_PARSE_MS = 10_000;

export function assertFileSizeBudget(byteLength: number): void {
  if (byteLength > MAX_EXCEL_FILE_SIZE_BYTES) {
    throw new Error('حجم ملف الإكسل يتجاوز الحد المسموح به (20 ميغابايت).');
  }
}

export function assertSheetBudget(sheetCount: number): void {
  if (sheetCount > MAX_EXCEL_SHEETS) {
    throw new Error(`عدد أوراق ملف الإكسل (${sheetCount}) يتجاوز الحد الأقصى المسموح به (${MAX_EXCEL_SHEETS}).`);
  }
}

export function assertRowBudget(totalRows: number): void {
  if (totalRows > MAX_EXCEL_ROWS_TOTAL) {
    throw new Error(`عدد صفوف ملف الإكسل يتجاوز الحد الأقصى المسموح به (${MAX_EXCEL_ROWS_TOTAL}).`);
  }
}

export function assertTimeBudget(startedAtMs: number): void {
  if (Date.now() - startedAtMs > MAX_EXCEL_PARSE_MS) {
    throw new Error('استغرقت قراءة ملف الإكسل وقتاً أطول من الحد المسموح به.');
  }
}

export interface RakmanaStudentRow {
  rowNumber: number;
  registrationNumber: string;
  lastName: string;
  firstName: string;
  fullName: string;
  gender: 'M' | 'F';
  birthDate: string;
  continuousEval?: number;
  quiz?: number;
  quiz2?: number;
  practical?: number;
  oral?: number;
  exam?: number;
  remarks?: string;
}

export interface RakmanaSheetMetadata {
  sheetName: string;
  rawClassLabel: string;
  className: string;
  stream: string;
  level: GradeLevel;
  levelCode: LevelCode;
  streamId: StreamId;
  groupNumber: number;
  detectedSubjectId?: SubjectId;
  detectedVariantId?: VariantId;
  term?: Term;
  academicYear?: string;
  schoolName?: string;
  wilaya?: string;
  headerRowNumber: number;
  columns: {
    regNumCol?: number;
    lastNameCol?: number;
    firstNameCol?: number;
    fullNameCol?: number;
    genderCol?: number;
    birthDateCol?: number;
    ccCol?: number;
    quizCol?: number;
    quiz2Col?: number;
    practicalCol?: number;
    oralCol?: number;
    examCol?: number;
    remarksCol?: number;
  };
  students: RakmanaStudentRow[];
}

export interface ParsedDigitizationClass {
  rawSheetName: string;
  className: string;
  suggestedName: string;
  stream: string;
  level: GradeLevel;
  levelCode: LevelCode;
  streamId: StreamId;
  detectedSubjectId?: SubjectId;
  detectedVariantId?: VariantId;
  students: Array<{
    numberInList: number;
    regNumber: string;
    registrationNumber: string;
    lastName: string;
    firstName: string;
    fullName: string;
    gender: 'M' | 'F';
    birthDate: string;
    continuousEval?: number;
    quiz?: number;
    quiz2?: number;
    practical?: number;
    oral?: number;
    exam?: number;
    remarks?: string;
  }>;
}

export interface ParsedDigitizationResult {
  classes: ParsedDigitizationClass[];
  totalStudents: number;
  schoolName?: string;
  academicYear?: string;
  stateName?: string;
  wilaya?: string;
  detectedSubjectId?: SubjectId;
  detectedVariantId?: VariantId;
}

export function detectLevelAndStream(
  sheetName: string,
  cellSampleOrRows: string | unknown[][] = ''
): {
  level: GradeLevel;
  stream: string;
  levelCode: LevelCode;
  streamId: StreamId;
  className: string;
  suggestedName: string;
} {
  const sampleText = Array.isArray(cellSampleOrRows)
    ? cellSampleOrRows
        .slice(0, 12)
        .map(row => (Array.isArray(row) ? row.map(c => String(c ?? '')).join(' ') : String(row ?? '')))
        .join(' ')
    : String(cellSampleOrRows ?? '');
  const combined = `${sheetName} ${sampleText}`.trim();
  const parsed = parseClassDescriptorToLevelAndStream(combined);
  const groupNum = extractGroupNumber(sheetName) || extractGroupNumber(sampleText) || 1;
  const level = mapLevelAndStreamToLegacyGradeLevel(parsed.levelCode, parsed.streamId);
  const suggestedName = `${parsed.shortStreamLabel} ${groupNum}`;
  return {
    level,
    stream: parsed.streamLabelAr,
    levelCode: parsed.levelCode,
    streamId: parsed.streamId,
    className: suggestedName,
    suggestedName,
  };
}

export function isSchoolSummaryOrFooterRow(
  cells: unknown[] | string,
  extraText?: unknown
): boolean {
  const baseText = Array.isArray(cells)
    ? cells.map(c => String(c ?? '')).join(' ')
    : String(cells ?? '');
  const combined = extraText ? `${baseText} ${String(extraText)}` : baseText;
  const rowText = normalizeArabicText(combined);
  if (!rowText) return true;
  if (
    rowText.includes('المعدل العام') ||
    rowText.includes('معدل القسم') ||
    rowText.includes('توقيع الاستاذ') ||
    rowText.includes('ختم المدير') ||
    rowText.includes('اعلى معدل') ||
    rowText.includes('ادنى معدل') ||
    rowText.includes('المجموع') ||
    rowText.includes('ثانويه') ||
    rowText.includes('مديريه التربيه')
  ) {
    return true;
  }
  return false;
}

function parseNumericCell(val: unknown): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'number') {
    return Number.isNaN(val) ? undefined : Math.round(val * 100) / 100;
  }
  const str = String(val).replace(',', '.').trim();
  if (!str) return undefined;
  const num = Number.parseFloat(str);
  return Number.isNaN(num) ? undefined : Math.round(num * 100) / 100;
}

function formatDateCell(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  return String(val).trim();
}

async function resolveInputBuffer(fileOrBuffer: File | ArrayBuffer): Promise<ArrayBuffer> {
  if (fileOrBuffer instanceof ArrayBuffer) {
    assertFileSizeBudget(fileOrBuffer.byteLength);
    return fileOrBuffer;
  }
  assertFileSizeBudget(fileOrBuffer.size);
  return await fileOrBuffer.arrayBuffer();
}

export async function parseRakmanaWorkbook(
  fileOrBuffer: File | ArrayBuffer
): Promise<RakmanaSheetMetadata[]> {
  const parseStartedAt = Date.now();
  const buffer = await resolveInputBuffer(fileOrBuffer);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array' });
  assertSheetBudget(workbook.SheetNames.length);
  const results: RakmanaSheetMetadata[] = [];
  let totalRowsSeen = 0;

  for (const sheetName of workbook.SheetNames) {
    assertTimeBudget(parseStartedAt);
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      raw: true,
    });

    if (!rows || rows.length === 0) continue;
    totalRowsSeen += rows.length;
    assertRowBudget(totalRowsSeen);

    let headerRowIdx = -1;
    let rawHeaderBanner = '';
    let schoolName: string | undefined;
    let academicYear: string | undefined;
    let wilaya: string | undefined;
    const columns: RakmanaSheetMetadata['columns'] = {};

    const maxScanRow = Math.min(25, rows.length);
    for (let rIdx = 0; rIdx < maxScanRow; rIdx++) {
      const rowCells = (rows[rIdx] || []).map(c => String(c ?? '').trim());
      const joinedRow = rowCells.join(' ');
      if (rIdx < 10) {
        rawHeaderBanner += ' ' + joinedRow;
        for (const text of rowCells) {
          if (!text) continue;
          if (text.includes('ثانوية') || text.includes('متقن')) {
            schoolName = schoolName || text;
          }
          if (text.includes('مديرية التربية لولاية') || text.includes('ولاية')) {
            wilaya = wilaya || text;
          }
          const yearMatch = text.match(/(20\d{2}\s*\/\s*20\d{2})/);
          if (yearMatch) {
            academicYear = academicYear || yearMatch[1].replace(/\s+/g, '');
          }
        }
      }

      const normRow = normalizeArabicText(joinedRow);
      if (
        headerRowIdx === -1 &&
        (normRow.includes('اللقب') || normRow.includes('الاسم') || normRow.includes('رقم التعريف'))
      ) {
        headerRowIdx = rIdx;
        rowCells.forEach((cellVal, cIdx) => {
          const colNumber = cIdx + 1;
          const text = normalizeArabicText(cellVal);
          if (!text) return;

          if (text.includes('رقم التعريف') || text.includes('الرقم الوطني') || text === 'الرقم') {
            if (columns.regNumCol === undefined) columns.regNumCol = colNumber;
          } else if (text.includes('اللقب والاسم') || text.includes('الاسم واللقب')) {
            columns.fullNameCol = colNumber;
          } else if (text.includes('اللقب')) {
            columns.lastNameCol = colNumber;
          } else if (text.includes('الاسم')) {
            columns.firstNameCol = colNumber;
          } else if (text.includes('الجنس') || text.includes('النوع')) {
            columns.genderCol = colNumber;
          } else if (text.includes('تاريخ الميلاد') || text.includes('تاريخ الازدياد')) {
            columns.birthDateCol = colNumber;
          } else if (
            text.includes('التقويم المستمر') ||
            text.includes('ت مستمر') ||
            text.includes('مراقبه مستمره') ||
            text === 'ت م' ||
            text.includes('التقويم')
          ) {
            columns.ccCol = colNumber;
          } else if (
            text.includes('اعمال تطبيقيه') ||
            text.includes('تطبيقي') ||
            text.includes('الاعمال التطبيقيه') ||
            text === 'ا ت'
          ) {
            columns.practicalCol = colNumber;
          } else if (
            text.includes('التعبير الشفوي') ||
            text.includes('تعبير شفوي') ||
            text.includes('شفوي') ||
            text.includes('الشفهي')
          ) {
            columns.oralCol = colNumber;
          } else if (text.includes('الفرض الثاني') || text.includes('فرض 2') || text.includes('الفرض 2')) {
            columns.quiz2Col = colNumber;
          } else if (
            text.includes('الفرض الاول') ||
            text.includes('فرض 1') ||
            text.includes('الفرض 1') ||
            text.includes('الفرض') ||
            text.includes('معدل الفروض')
          ) {
            if (columns.quizCol === undefined) {
              columns.quizCol = colNumber;
            } else if (columns.quiz2Col === undefined) {
              columns.quiz2Col = colNumber;
            }
          } else if (text.includes('الاختبار') || text.includes('اختبار')) {
            columns.examCol = colNumber;
          } else if (
            text.includes('التقدير') ||
            text.includes('الملاحظات') ||
            text.includes('ارشادات') ||
            text.includes('ملاحظه')
          ) {
            columns.remarksCol = colNumber;
          }
        });
      }
    }

    if (headerRowIdx === -1) continue;

    const classDescriptorSource = `${sheetName} ${rawHeaderBanner}`;
    const parsedStream = parseClassDescriptorToLevelAndStream(classDescriptorSource);
    const groupNumber = extractGroupNumber(sheetName) || extractGroupNumber(rawHeaderBanner) || 1;
    const legacyLevel = mapLevelAndStreamToLegacyGradeLevel(parsedStream.levelCode, parsedStream.streamId);
    const className = `${parsedStream.shortStreamLabel} ${groupNumber}`;
    const detectedSubject = detectSubjectFromRakmanaHeader(classDescriptorSource);

    const students: RakmanaStudentRow[] = [];

    for (let rIdx = headerRowIdx + 1; rIdx < rows.length; rIdx++) {
      assertTimeBudget(parseStartedAt);
      const rowCells = rows[rIdx] || [];
      if (isSchoolSummaryOrFooterRow(rowCells)) continue;

      const getVal = (colNum?: number) => (colNum !== undefined ? rowCells[colNum - 1] : undefined);

      const regNum = String(getVal(columns.regNumCol) ?? '').trim();
      let lastName = String(getVal(columns.lastNameCol) ?? '').trim();
      let firstName = String(getVal(columns.firstNameCol) ?? '').trim();
      let fullName = String(getVal(columns.fullNameCol) ?? '').trim();

      if (!fullName && (lastName || firstName)) {
        fullName = `${lastName} ${firstName}`.trim();
      } else if (fullName && !lastName && !firstName) {
        const parts = fullName.split(/\s+/);
        lastName = parts[0] || '';
        firstName = parts.slice(1).join(' ') || '';
      }

      if (!fullName || fullName.length < 2) continue;

      const rawGender = normalizeArabicText(String(getVal(columns.genderCol) ?? ''));
      const gender: 'M' | 'F' =
        rawGender.includes('انث') || rawGender === 'ا' || rawGender === 'f' ? 'F' : 'M';
      const birthDate = formatDateCell(getVal(columns.birthDateCol));

      students.push({
        rowNumber: rIdx + 1,
        registrationNumber: regNum,
        lastName,
        firstName,
        fullName,
        gender,
        birthDate,
        continuousEval: parseNumericCell(getVal(columns.ccCol)),
        quiz: parseNumericCell(getVal(columns.quizCol)),
        quiz2: parseNumericCell(getVal(columns.quiz2Col)),
        practical: parseNumericCell(getVal(columns.practicalCol)),
        oral: parseNumericCell(getVal(columns.oralCol)),
        exam: parseNumericCell(getVal(columns.examCol)),
        remarks:
          getVal(columns.remarksCol) !== undefined
            ? String(getVal(columns.remarksCol) ?? '').trim()
            : undefined,
      });
    }

    if (students.length > 0) {
      results.push({
        sheetName,
        rawClassLabel: classDescriptorSource.trim(),
        className,
        stream: parsedStream.streamLabelAr,
        level: legacyLevel,
        levelCode: parsedStream.levelCode,
        streamId: parsedStream.streamId,
        groupNumber,
        detectedSubjectId: detectedSubject.subjectId,
        detectedVariantId: detectedSubject.variantId,
        schoolName,
        academicYear,
        wilaya,
        headerRowNumber: headerRowIdx + 1,
        columns,
        students,
      });
    }
  }

  return results;
}

export async function parseDigitizationFile(
  fileOrBuffer: File | ArrayBuffer
): Promise<ParsedDigitizationResult> {
  const sheets = await parseRakmanaWorkbook(fileOrBuffer);
  const classes: ParsedDigitizationClass[] = sheets.map(sheet => ({
    rawSheetName: sheet.sheetName,
    className: sheet.className,
    suggestedName: sheet.className,
    stream: sheet.stream,
    level: sheet.level,
    levelCode: sheet.levelCode,
    streamId: sheet.streamId,
    detectedSubjectId: sheet.detectedSubjectId,
    detectedVariantId: sheet.detectedVariantId,
    students: sheet.students.map((st, idx) => ({
      numberInList: idx + 1,
      regNumber: st.registrationNumber,
      registrationNumber: st.registrationNumber,
      lastName: st.lastName,
      firstName: st.firstName,
      fullName: st.fullName,
      gender: st.gender,
      birthDate: st.birthDate,
      continuousEval: st.continuousEval,
      quiz: st.quiz,
      quiz2: st.quiz2,
      practical: st.practical,
      oral: st.oral,
      exam: st.exam,
      remarks: st.remarks,
    })),
  }));

  const totalStudents = classes.reduce((sum, cls) => sum + cls.students.length, 0);
  const firstWithSchool = sheets.find(s => s.schoolName);
  const firstWithYear = sheets.find(s => s.academicYear);
  const firstWithWilaya = sheets.find(s => s.wilaya);
  const firstWithSubject = sheets.find(s => s.detectedSubjectId);

  return {
    classes,
    totalStudents,
    schoolName: firstWithSchool?.schoolName,
    academicYear: firstWithYear?.academicYear,
    stateName: firstWithWilaya?.wilaya,
    wilaya: firstWithWilaya?.wilaya,
    detectedSubjectId: firstWithSubject?.detectedSubjectId,
    detectedVariantId: firstWithSubject?.detectedVariantId,
  };
}

export interface ExportRakmanaGradesOptions {
  buffer: File | ArrayBuffer;
  sheetName?: string;
  students: Student[];
  grades: StudentGrade[];
  subjectId?: SubjectId;
  levelCode?: LevelCode;
  streamId?: StreamId;
  overrides?: EducationOverrides;
}

export interface GradeInjectionResult {
  blob: Blob;
  buffer: ArrayBuffer;
  matchedStudents: number;
  gradesWritten: number;
  unmatchedSheetStudents: string[];
}

export async function injectGradesIntoFile(
  fileOrBuffer: File | ArrayBuffer,
  students: Student[],
  grades: StudentGrade[],
  options?: {
    subjectId?: SubjectId;
    levelCode?: LevelCode;
    streamId?: StreamId;
    overrides?: EducationOverrides;
  }
): Promise<GradeInjectionResult> {
  const parseStartedAt = Date.now();
  const buffer = await resolveInputBuffer(fileOrBuffer);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array' });
  assertSheetBudget(workbook.SheetNames.length);
  const parsedSheets = await parseRakmanaWorkbook(buffer);

  let matchedStudents = 0;
  let gradesWritten = 0;
  const unmatchedSheetStudents: string[] = [];

  for (const sheetMeta of parsedSheets) {
    assertTimeBudget(parseStartedAt);
    const worksheet = workbook.Sheets[sheetMeta.sheetName];
    if (!worksheet) continue;

    const effectiveSubjectId =
      options?.subjectId ?? sheetMeta.detectedSubjectId ?? 'ISLAMIC';
    const effectiveLevelCode = options?.levelCode ?? sheetMeta.levelCode;
    const effectiveStreamId = options?.streamId ?? sheetMeta.streamId;
    const resolvedScheme = resolveEffectiveScheme({
      levelCode: effectiveLevelCode,
      streamId: effectiveStreamId,
      subjectId: effectiveSubjectId,
      overrides: options?.overrides,
    });
    const hasQuiz2InScheme = resolvedScheme.devoirCount >= 2;

    const setCellVal = (
      rowNumber1Based: number,
      colNumber1Based: number | undefined,
      value: string | number | null | undefined
    ) => {
      if (colNumber1Based === undefined || value === null || value === undefined) return;
      const cellRef = XLSX.utils.encode_cell({ r: rowNumber1Based - 1, c: colNumber1Based - 1 });
      worksheet[cellRef] = {
        t: typeof value === 'number' ? 'n' : 's',
        v: value,
      };
      gradesWritten++;
    };

    for (const sheetSt of sheetMeta.students) {
      const matchedStudent = students.find(st => {
        if (
          sheetSt.registrationNumber &&
          (st.registrationNumber || st.regNumber) &&
          sheetSt.registrationNumber === (st.registrationNumber || st.regNumber)
        ) {
          return true;
        }
        return areNamesMatching(sheetSt.fullName, st.fullName);
      });

      if (!matchedStudent) {
        unmatchedSheetStudents.push(sheetSt.fullName);
        continue;
      }

      const grade = grades.find(
        g =>
          g.studentId === matchedStudent.id &&
          (!options?.subjectId || !g.subjectId || g.subjectId === options.subjectId)
      );
      if (!grade) continue;

      matchedStudents++;

      const ccVal = calculateContinuousEval(grade);
      if (sheetMeta.columns.ccCol !== undefined && ccVal !== undefined) {
        setCellVal(sheetSt.rowNumber, sheetMeta.columns.ccCol, ccVal);
      }

      const tpVal = grade.extraMarks?.tp ?? grade.extraMarks?.practical;
      if (sheetMeta.columns.practicalCol !== undefined && tpVal !== undefined) {
        setCellVal(sheetSt.rowNumber, sheetMeta.columns.practicalCol, tpVal);
      }

      if (sheetMeta.columns.oralCol !== undefined && grade.extraMarks?.oral !== undefined) {
        setCellVal(sheetSt.rowNumber, sheetMeta.columns.oralCol, grade.extraMarks.oral);
      }

      const quiz2Val = grade.extraMarks?.devoir2 ?? grade.extraMarks?.quiz2;
      if (sheetMeta.columns.quiz2Col !== undefined) {
        if (grade.quiz !== undefined && grade.quiz !== null && sheetMeta.columns.quizCol !== undefined) {
          setCellVal(sheetSt.rowNumber, sheetMeta.columns.quizCol, grade.quiz);
        }
        if (quiz2Val !== undefined) {
          setCellVal(sheetSt.rowNumber, sheetMeta.columns.quiz2Col, quiz2Val);
        }
      } else if (sheetMeta.columns.quizCol !== undefined) {
        const devoirAvg = resolveDevoirAverage(grade, hasQuiz2InScheme);
        if (devoirAvg !== undefined) {
          setCellVal(sheetSt.rowNumber, sheetMeta.columns.quizCol, devoirAvg);
        }
      }

      if (sheetMeta.columns.examCol !== undefined && grade.exam !== undefined && grade.exam !== null) {
        setCellVal(sheetSt.rowNumber, sheetMeta.columns.examCol, grade.exam);
      }

      if (sheetMeta.columns.remarksCol !== undefined) {
        const obs =
          grade.remarks || grade.estimation || getObservation(grade.exam, effectiveSubjectId);
        if (obs) {
          setCellVal(sheetSt.rowNumber, sheetMeta.columns.remarksCol, obs);
        }
      }
    }
  }

  const outBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([outBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  return {
    blob,
    buffer: outBuffer,
    matchedStudents,
    gradesWritten,
    unmatchedSheetStudents,
  };
}

export async function exportGradesToRakmanaWorkbook(
  options: ExportRakmanaGradesOptions
): Promise<{ buffer: ArrayBuffer; matchedCount: number; totalSheetStudents: number }> {
  const parsed = await parseRakmanaWorkbook(options.buffer);
  const totalSheetStudents = parsed.reduce((sum, s) => sum + s.students.length, 0);
  const res = await injectGradesIntoFile(options.buffer, options.students, options.grades, {
    subjectId: options.subjectId,
    levelCode: options.levelCode,
    streamId: options.streamId,
    overrides: options.overrides,
  });
  return {
    buffer: res.buffer,
    matchedCount: res.matchedStudents,
    totalSheetStudents,
  };
}
