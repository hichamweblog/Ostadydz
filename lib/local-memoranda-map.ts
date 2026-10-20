import { CurriculumUnit, GradeLevel } from './types';

const LEVEL_FOLDERS: Record<GradeLevel, string> = {
  '1AS_ARTS': '1as-arts',
  '1AS_SCIENCE': '1as-science',
  '2AS': '2as',
  '3AS': '3as',
};

export interface LocalMemorandum {
  fileName: string;
  pdfUrl: string;
}

export function getLocalMemorandum(
  unit: Pick<CurriculumUnit, 'id' | 'level'>
): LocalMemorandum | undefined {
  const folder = LEVEL_FOLDERS[unit.level];
  const fileName = `${unit.id}.pdf`;

  return {
    fileName,
    pdfUrl: `/memoranda/${folder}/${fileName}`,
  };
}

export function enrichUnitsWithLocalMemoranda(units: CurriculumUnit[]): CurriculumUnit[] {
  return units.map(unit => {
    const memorandum = getLocalMemorandum(unit);
    if (!memorandum) return unit;

    return {
      ...unit,
      pdfFileName: unit.pdfFileName || memorandum.fileName,
      pdfUrl: unit.pdfUrl || memorandum.pdfUrl,
    };
  });
}
