import { strToU8, zipSync } from 'fflate';
import type { SheetData } from 'read-excel-file/node';

export function workbookBytes(rows: SheetData, reportSheet = 'Sheet1'): Buffer {
  const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function sheetXml(data: SheetData): string {
    const contents = data.map((cells, index) => {
      const serialized = cells.map((value, column) => {
        if (value == null) return '';
        const ref = `${String.fromCharCode(65 + column)}${index + 1}`;
        return typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>` :
          `<c r="${ref}" t="inlineStr"><is><t>${escape(String(value))}</t></is></c>`;
      }).join('');
      return `<row r="${index + 1}">${serialized}</row>`;
    }).join('');
    return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${contents}</sheetData></worksheet>`;
  }
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="DATA" sheetId="1" r:id="rId1"/><sheet name="${escape(reportSheet)}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml([[null, 'This is not the report sheet']]),
    'xl/worksheets/sheet2.xml': sheetXml(rows)
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, strToU8(contents)]))));
}
