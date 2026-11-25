import React, { useRef, useState } from 'react';
import {
  FolderUp,
  Globe,
  RefreshCw,
  Trash2,
  Upload,
  X,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { importNinjaFiles, type ImportReportItem } from '../importers/ninjaImporter';
import {
  deleteImportedNinja,
  getSavedRepoBaseUrl,
  setSavedRepoBaseUrl,
} from '../storage/ninjaDb';
import type { NinjaRosterEntry } from '../types/shinobi';

interface ImportModalProps {
  open: boolean;
  roster: NinjaRosterEntry[];
  detectedRepoUrl: string | null;
  onClose: () => void;
  onRosterChanged: (newRepoUrl?: string) => Promise<void>;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  open,
  roster,
  detectedRepoUrl,
  onClose,
  onRosterChanged,
}) => {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [reports, setReports] = useState<ImportReportItem[]>([]);
  const [globalWarnings, setGlobalWarnings] = useState<string[]>([]);
  const [repoInput, setRepoInput] = useState(() => getSavedRepoBaseUrl());
  const [repoStatus, setRepoStatus] = useState<string | null>(null);

  if (!open) return null;

  const importedEntries = roster.filter(
    (n) => n.source === 'imported-phaser' || n.source === 'imported-legacy'
  );
  const repoEntries = roster.filter((n) => n.source === 'repo');

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setReports([]);
    setGlobalWarnings([]);
    setProgressMsg('Analisando arquivos selecionados...');

    try {
      const { results, globalWarnings: gw } = await importNinjaFiles(files, (msg) =>
        setProgressMsg(msg)
      );
      setReports(results);
      setGlobalWarnings(gw);
      setProgressMsg('');
      await onRosterChanged();
    } catch (err) {
      setReports([
        {
          id: 'err',
          name: 'Importação',
          format: 'shinobi-phaser-v1',
          animCount: 0,
          effectCount: 0,
          audioCount: 0,
          videoCount: 0,
          warnings: [],
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setBusy(false);
      setProgressMsg('');
      if (zipInputRef.current) zipInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleSaveRepoUrl = async () => {
    setBusy(true);
    setRepoStatus('Consultando index.json...');
    try {
      setSavedRepoBaseUrl(repoInput);
      await onRosterChanged(repoInput);
      setRepoStatus(
        repoInput.trim()
          ? 'Repositório sincronizado com sucesso.'
          : 'URL limpa. Usando pasta local do jogo.'
      );
    } catch {
      setRepoStatus('Não foi possível ler index.json nessa URL.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteImportedNinja(id);
      await onRosterChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Importar Ninjas e Repositório"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-[#121931] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-wide text-amber-300">
              Importar Ninjas e Assets
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Formato shinobi-phaser-v1 (ZIP único ou múltiplos até 20 MB), pasta exportada ou legado *_completo.zip (.001/.002)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 text-slate-300 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-400"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* Manual Import Actions */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">
              1. Importação manual (salvo no navegador em Blobs leves)
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => zipInputRef.current?.click()}
                className="flex min-h-[56px] items-center justify-center gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
              >
                <Upload className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">Selecionar .ZIP / Partes (.001)</span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => folderInputRef.current?.click()}
                className="flex min-h-[56px] items-center justify-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800/70 px-4 py-3 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700/80 disabled:opacity-50"
              >
                <FolderUp className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">Importar Pasta do Estúdio</span>
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Dica: para exports divididos em vários ZIPs (até 20 MB cada) ou arquivos legados{' '}
              <span className="font-mono-num text-slate-300">.zip.t0.001 + .002</span>, selecione todos os arquivos juntos de uma só vez.
            </p>

            <input
              ref={zipInputRef}
              type="file"
              multiple
              accept=".zip,.001,.002,.003,.004,.005,.006,.007,.008,.009,.part1,.part2,.part3"
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as any)}
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
          </div>

          {/* Progress indicator */}
          {busy && progressMsg && (
            <div className="flex items-center gap-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
              <span>{progressMsg}</span>
            </div>
          )}

          {/* Import Reports */}
          {(reports.length > 0 || globalWarnings.length > 0) && (
            <div className="space-y-2 border-t border-slate-800 pt-4">
              <h4 className="text-xs font-semibold text-slate-300">Resultado da importação</h4>
              {globalWarnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
              {reports.map((r, i) => (
                <div
                  key={`${r.id}-${i}`}
                  className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                    r.ok
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                      : 'border-rose-500/35 bg-rose-500/10 text-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {r.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                    )}
                    <span>{r.name}</span>
                    {r.ok && (
                      <span className="font-normal text-slate-300">
                        · {r.format} · {r.animCount} anim · {r.effectCount} fx · {r.audioCount} sons
                        {r.videoCount > 0 ? ` · ${r.videoCount} vídeo` : ''}
                      </span>
                    )}
                  </div>
                  {r.error && <p className="mt-1 text-rose-200">{r.error}</p>}
                  {r.warnings.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-200/90">
                      {r.warnings.slice(0, 4).map((w, wi) => (
                        <li key={wi}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Direct Repository Loader */}
          <div className="space-y-2.5 border-t border-slate-800 pt-5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Globe className="h-4 w-4 text-sky-400" />
                <span>2. Carregamento automático por repositório (index.json)</span>
              </h3>
              <span className="text-xs text-slate-400">
                {repoEntries.length} ninja(s) ativo(s)
              </span>
            </div>
            <p className="text-xs text-slate-400">
              O jogo detecta automaticamente <span className="font-mono-num text-slate-300">./assets/index.json</span> no repositório. Você também pode informar a URL pública (ex: GitHub Raw) onde o estúdio exportou a pasta de assets:
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="https://raw.githubusercontent.com/usuario/repo/main/assets"
                className="min-h-[42px] flex-1 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveRepoUrl}
                className="min-h-[42px] whitespace-nowrap rounded-lg bg-slate-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-600 disabled:opacity-50"
              >
                Sincronizar
              </button>
            </div>
            {(repoStatus || detectedRepoUrl) && (
              <p className="text-xs text-slate-400">
                {repoStatus || `Detectado em: ${detectedRepoUrl}`}
              </p>
            )}
          </div>

          {/* Imported Ninjas List */}
          <div className="space-y-2.5 border-t border-slate-800 pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">
                Ninjas salvos neste dispositivo ({importedEntries.length})
              </h3>
            </div>
            {importedEntries.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nenhum ninja importado manualmente ainda. Os 4 ninjas embutidos continuam disponíveis normalmente.
              </p>
            ) : (
              <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/50">
                {importedEntries.map((n) => (
                  <div key={n.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="h-10 w-10 shrink-0 rounded-full border border-slate-700 bg-slate-800 bg-cover bg-center"
                        style={
                          n.previewFaceUrl
                            ? { backgroundImage: `url(${n.previewFaceUrl})` }
                            : undefined
                        }
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-100">{n.name}</div>
                        <div className="truncate text-xs text-slate-400">
                          {n.formatLabel} · {n.combat.natureLabel} · {n.combat.roleLabel} ·{' '}
                          {n.combat.chasers.length} perseguição(ões)
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDelete(n.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700/80 text-slate-400 transition-colors hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-300"
                      aria-label={`Remover ${n.name}`}
                      title="Remover ninja"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[40px] rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
