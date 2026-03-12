import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileText, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { uploadDocuments, runDocCheck } from '../services/api';

/**
 * Drag-and-drop document upload zone.
 * Accepts PDF, JPG, PNG. Shows per-file status with icons.
 * After upload, automatically triggers doc-check.
 *
 * Props:
 *   claimId — current claim ID
 *   onUploadComplete — callback after upload + doc check
 */
export default function DocumentUpload({ claimId, onUploadComplete }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  const addFiles = (newFiles) => {
    const accepted = Array.from(newFiles).filter((f) =>
      ['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)
    );
    const wrapped = accepted.map((f) => ({
      file: f,
      name: f.name,
      size: f.size,
      status: 'pending', // pending | uploading | success | error
    }));
    setFiles((prev) => [...prev, ...wrapped]);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleFileSelect = (e) => {
    if (e.target.files) addFiles(e.target.files);
  };

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpload = async () => {
    if (!claimId || files.length === 0) return;
    setUploading(true);

    // Mark all as uploading
    setFiles((prev) => prev.map((f) => ({ ...f, status: 'uploading' })));

    try {
      const rawFiles = files.map((f) => f.file);
      await uploadDocuments(claimId, rawFiles);
      setFiles((prev) => prev.map((f) => ({ ...f, status: 'success' })));

      // Auto-trigger doc check
      try {
        await runDocCheck(claimId);
      } catch {
        // Doc check can fail if not ready — not fatal
      }

      onUploadComplete?.();
    } catch (err) {
      setFiles((prev) => prev.map((f) => ({ ...f, status: 'error' })));
    } finally {
      setUploading(false);
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const statusIcon = (status) => {
    switch (status) {
      case 'uploading':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <FileText className="w-4 h-4 text-slate-400" />;
    }
  };

  const pendingFiles = files.filter((f) => f.status === 'pending');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <Upload className="w-5 h-5 text-blue-500" />
          Upload Medical Documents
        </h3>
      </div>

      <div className="p-6">
        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
            transition-all duration-200
            ${isDragOver
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
            }
          `}
        >
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Upload className={`w-6 h-6 ${isDragOver ? 'text-blue-600' : 'text-blue-400'}`} />
          </div>
          <p className="text-sm font-medium text-slate-700">
            Drop files here or <span className="text-blue-600 font-semibold">browse</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">PDF, JPG, PNG — Max 10 MB</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map((f, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100"
              >
                {statusIcon(f.status)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{f.name}</p>
                  <p className="text-[11px] text-slate-400">{formatSize(f.size)}</p>
                </div>
                {f.status === 'pending' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Upload button */}
        {pendingFiles.length > 0 && (
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
