"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { type ChunkResult, finishImport, importChunk, startImport } from "./actions";
import { type ColumnMapping, CSV_FIELDS, type CsvFieldKey, guessMapping, IMPORT_CHUNK_SIZE, mapRow, MAX_IMPORT_ROWS, validateMapping } from "./csv";

type Parsed = { fileName: string; headers: string[]; rows: Record<string, string>[]; fileDate: string };

/** Column added to every row when the file has no date column and the user gives one date for all. */
const GIVEN_DATE_COLUMN = "วันที่ได้ข้อมูล (ระบุตอนนำเข้า)";

/** The mapping and rows actually sent: the user's mapping plus the date given for the whole file. */
function withGivenDate(parsed: Parsed, mapping: ColumnMapping, date: string): { mapping: ColumnMapping; rows: Record<string, string>[] } {
  if (mapping.retrieved_at || !date) return { mapping, rows: parsed.rows };
  return { mapping: { ...mapping, retrieved_at: GIVEN_DATE_COLUMN }, rows: parsed.rows.map((r) => ({ ...r, [GIVEN_DATE_COLUMN]: date })) };
}

const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
type Phase =
  | { kind: "select" }
  | { kind: "map"; parsed: Parsed }
  | { kind: "importing"; parsed: Parsed; done: number; totals: ChunkResult }
  | { kind: "finished"; batchId: string; totals: ChunkResult; error?: string };

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const empty: ChunkResult = { inserted: 0, updated: 0, duplicates: 0, failed: 0 };

export function CsvImport({ initialMode = "skip" }: { initialMode?: "skip" | "update" }) {
  const [phase, setPhase] = useState<Phase>({ kind: "select" });
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [duplicateMode, setDuplicateMode] = useState<"skip" | "update">(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [givenDate, setGivenDate] = useState("");

  function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setError("ไฟล์ใหญ่เกิน 20 MB");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter((h) => h.trim() !== "");
        if (!headers.length) return setError("ไม่พบหัวคอลัมน์ในไฟล์ (แถวแรกต้องเป็นชื่อคอลัมน์)");
        if (!res.data.length) return setError("ไฟล์ไม่มีข้อมูล");
        if (res.data.length > MAX_IMPORT_ROWS) return setError(`นำเข้าได้ครั้งละไม่เกิน ${MAX_IMPORT_ROWS.toLocaleString()} แถว`);
        setMapping(guessMapping(headers));
        // Exports like Shopee's bulk-link file have no date column: default to the file's own date.
        setGivenDate(localDate(file.lastModified));
        setPhase({ kind: "map", parsed: { fileName: file.name, headers, rows: res.data, fileDate: localDate(file.lastModified) } });
      },
      error: (err) => setError(`อ่านไฟล์ไม่สำเร็จ: ${err.message}`),
    });
  }

  async function run(input: Parsed) {
    setError(null);
    setStarting(true);
    const sent = withGivenDate(input, mapping, givenDate);
    const parsed = { ...input, rows: sent.rows };
    const mapping_ = sent.mapping;
    const started = await startImport({ fileName: parsed.fileName, totalRows: parsed.rows.length, duplicateMode, mapping: mapping_ }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
    setStarting(false);
    if (!started.ok) return setError(started.error);
    const { batchId } = started.data;

    const totals = { ...empty };
    setPhase({ kind: "importing", parsed, done: 0, totals });
    for (let i = 0; i < parsed.rows.length; i += IMPORT_CHUNK_SIZE) {
      // Send only mapped columns to keep payloads small.
      const used = Object.values(mapping_).filter(Boolean) as string[];
      const rows = parsed.rows.slice(i, i + IMPORT_CHUNK_SIZE).map((r) => Object.fromEntries(used.map((h) => [h, r[h]])));
      let res: Awaited<ReturnType<typeof importChunk>>;
      try {
        res = await importChunk({ batchId, firstRowNumber: i + 2, rows }); // +2: header row + 1-based
      } catch {
        res = { ok: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" };
      }
      if (!res.ok) {
        await finishImport(batchId, "failed");
        setPhase({ kind: "finished", batchId, totals, error: `หยุดที่แถว ${i + 2}: ${res.error}` });
        return;
      }
      for (const k of Object.keys(totals) as (keyof ChunkResult)[]) totals[k] += res.data[k];
      setPhase({ kind: "importing", parsed, done: Math.min(i + IMPORT_CHUNK_SIZE, parsed.rows.length), totals: { ...totals } });
    }
    await finishImport(batchId, "completed");
    setPhase({ kind: "finished", batchId, totals });
  }

  if (phase.kind === "select") {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <Label htmlFor="csv">ไฟล์ CSV (UTF-8, แถวแรกเป็นชื่อคอลัมน์)</Label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="rounded-lg border border-input bg-surface p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        <p className="text-xs text-muted-foreground">
          ฟิลด์ที่รองรับ: {CSV_FIELDS.map((f) => f.label.split(" (")[0]).join(", ")} — ช่องว่างจะถูกเก็บเป็น “ไม่มีข้อมูล” ไม่ใช่ 0
        </p>
        {error && <ErrorBox message={error} />}
      </div>
    );
  }

  if (phase.kind === "map") return <MappingStep parsed={phase.parsed} mapping={mapping} setMapping={setMapping} duplicateMode={duplicateMode} setDuplicateMode={setDuplicateMode} givenDate={givenDate} setGivenDate={setGivenDate} error={error} starting={starting} onBack={() => setPhase({ kind: "select" })} onRun={() => run(phase.parsed)} />;

  if (phase.kind === "importing") {
    const pct = Math.round((phase.done / phase.parsed.rows.length) * 100);
    return (
      <div className="flex max-w-xl flex-col gap-3" aria-live="polite">
        <p className="text-sm">
          กำลังนำเข้า {phase.done.toLocaleString()} / {phase.parsed.rows.length.toLocaleString()} แถว…
        </p>
        <Progress value={pct} />
        <Summary totals={phase.totals} />
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4" aria-live="polite">
      {phase.error ? <ErrorBox message={phase.error} /> : <Notice tone="success">นำเข้าเสร็จแล้ว</Notice>}
      <Summary totals={phase.totals} />
      <div className="flex gap-2">
        <Button asChild>
          <Link href={`/imports/${phase.batchId}`}>ดูรายละเอียดและแถวที่ผิดพลาด</Link>
        </Button>
        <Button variant="outline" onClick={() => setPhase({ kind: "select" })}>
          นำเข้าไฟล์อื่น
        </Button>
      </div>
    </div>
  );
}

function MappingStep({
  parsed,
  mapping,
  setMapping,
  duplicateMode,
  setDuplicateMode,
  givenDate,
  setGivenDate,
  error,
  starting,
  onBack,
  onRun,
}: {
  parsed: Parsed;
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  duplicateMode: "skip" | "update";
  setDuplicateMode: (m: "skip" | "update") => void;
  givenDate: string;
  setGivenDate: (d: string) => void;
  error: string | null;
  starting: boolean;
  onBack: () => void;
  onRun: () => void;
}) {
  const mappingError = validateMapping(mapping);
  // Client-side preview of validation on the first 200 rows; the server re-validates everything.
  const preview = useMemo(() => {
    if (mappingError) return null;
    const sent = withGivenDate({ ...parsed, rows: parsed.rows.slice(0, 200) }, mapping, givenDate);
    const sample = sent.rows.map((r) => mapRow(r, sent.mapping));
    return { checked: sample.length, invalid: sample.filter((s) => !s.ok).length, firstError: sample.find((s) => !s.ok) };
  }, [parsed, mapping, mappingError, givenDate]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{parsed.fileName}</span> — {parsed.rows.length.toLocaleString()} แถว, {parsed.headers.length} คอลัมน์
      </p>

      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        {CSV_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`map-${f.key}`}>
              {f.label}
              {"required" in f && f.required && <span className="text-destructive"> *</span>}
            </Label>
            <NativeSelect
              id={`map-${f.key}`}
              value={mapping[f.key] ?? ""}
              onChange={(e) => {
                const next = { ...mapping };
                if (e.target.value) next[f.key as CsvFieldKey] = e.target.value;
                else delete next[f.key as CsvFieldKey];
                setMapping(next);
              }}
            >
              <option value="">— ไม่นำเข้า —</option>
              {parsed.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>

      {!mapping.retrieved_at && (
        <div className="flex max-w-xs flex-col gap-1">
          <Label htmlFor="given-date">วันที่ได้ข้อมูลราคา/ค่าคอม (ใช้กับทุกแถว)</Label>
          <Input id="given-date" type="date" value={givenDate} max={localDate(Date.now())} onChange={(e) => setGivenDate(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            ไฟล์ไม่มีคอลัมน์วันที่ — ค่าเริ่มต้นคือวันที่ของไฟล์ ({parsed.fileDate}) ปล่อยว่างถ้าไม่ทราบ
          </p>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-semibold">เมื่อพบสินค้าซ้ำ (รหัสสินค้าหรือลิงก์สินค้าตรงกัน)</legend>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="dup" checked={duplicateMode === "skip"} onChange={() => setDuplicateMode("skip")} /> ข้าม เก็บข้อมูลเดิมไว้
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="dup" checked={duplicateMode === "update"} onChange={() => setDuplicateMode("update")} /> อัปเดตด้วยค่าจากไฟล์ (ช่องว่างในไฟล์จะไม่ลบข้อมูลเดิม)
        </label>
      </fieldset>

      {(mappingError || error) && <ErrorBox message={(mappingError ?? error)!} />}
      {preview && (
        <p className="text-[13px] text-muted-foreground">
          ตรวจ {preview.checked} แถวแรก: ผิดพลาด {preview.invalid} แถว
          {preview.firstError && !preview.firstError.ok && ` (เช่น ${preview.firstError.errors[0]?.message})`} — แถวที่ผิดจะถูกแยกไว้ ไม่บล็อกแถวอื่น
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={onRun} disabled={!!mappingError || starting}>
          {starting ? "กำลังเริ่ม…" : `นำเข้า ${parsed.rows.length.toLocaleString()} แถว`}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          เลือกไฟล์ใหม่
        </Button>
      </div>
    </div>
  );
}

function Summary({ totals }: { totals: ChunkResult }) {
  const items = [
    ["เพิ่มใหม่", totals.inserted],
    ["อัปเดต", totals.updated],
    ["ซ้ำ (ข้าม)", totals.duplicates],
    ["ผิดพลาด", totals.failed],
  ] as const;
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {items.map(([label, n]) => (
        <div key={label}>
          <dt className="text-[13px] text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{n.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <Notice tone="error">{message}</Notice>;
}
