import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET() {
  try {
    const schemaPath = path.join(process.cwd(), 'supabase', 'schema.sql');
    const sql = await fs.readFile(schemaPath, 'utf8');
    return NextResponse.json({ sql });
  } catch (error) {
    console.error('Failed to read supabase/schema.sql:', error);
    return NextResponse.json(
      { error: 'تعذر قراءة ملف المخطط التأسيسي supabase/schema.sql' },
      { status: 500 },
    );
  }
}
