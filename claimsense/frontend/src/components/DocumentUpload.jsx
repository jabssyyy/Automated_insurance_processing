/**
 * DocumentUpload — drag-and-drop document upload for patients.
 */

import React, { useState, useRef, useCallback } from 'react'
import { Upload, FileText, CheckCircle2, XCircle, Loader2, CloudUpload } from 'lucide-react'
import { uploadDocuments, runDocCheck } from '../services/api'

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
const ACCEPTED_LABEL = 'PDF, JPG, PNG'

function FileRow({ file }) {
  const icons = {
    uploading: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
    done:      <CheckCircle2 className="w-4 h-4 text-green-500" />,
    error:     <XCircle className="w-4 h-4 text-red-500" />,
    pending:   <FileText className="w-4 h-4 text-slate-400" />,
  }
  const labels = {
    uploading: 'Uploading…',
    done:      'Uploaded',
    error:     file.error || 'Upload failed',
    pending:   `${(file.file.size / 1024).toFixed(0)} KB`,
  }

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-50 border border-slate-100">
      {icons[file.status]}
      <span className="flex-1 text-sm text-slate-700 truncate">{file.file.name}</span>
      <span className={`text-xs font-medium ${
        file.status === 'done' ? 'text-green-600' :
        file.status === 'error' ? 'text-red-600' :
        file.status === 'uploading' ? 'text-blue-600' :
        'text-slate-400'
      }`}>
        {labels[file.status]}
      </span>
    </div>
  )
}

export default function DocumentUpload({ claimId, onUploadComplete }) {
  const [fileList, setFileList]   = useState([])
  const [isDragOver, setDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef(null)

  const addFiles = useCallback((newFiles) => {
    const entries = Array.from(newFiles)
      .filter((f) => ACCEPTED_TYPES.includes(f.type))
      .map((f) => ({ file: f, status: 'pending', error: null }))
    setFileList((prev) => [...prev, ...entries])
  }, [])

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    addFiles(e.dataTransfer.files)
  }

  const handleFileInput = (e) => {
    addFiles(e.target.files)
    e.target.value = ''
  }

  const handleUpload = async () => {
    const pendingFiles = fileList.filter((f) => f.status === 'pending')
    if (pendingFiles.length === 0) return

    setIsUploading(true)

    // Mark all as uploading
    setFileList((prev) =>
      prev.map((f) => f.status === 'pending' ? { ...f, status: 'uploading' } : f)
    )

    try {
      await uploadDocuments(claimId, pendingFiles.map((f) => f.file))
      // Mark done
      setFileList((prev) =>
        prev.map((f) => f.status === 'uploading' ? { ...f, status: 'done' } : f)
      )
      // Auto-trigger doc check
      try {
        await runDocCheck(claimId)
      } catch { /* doc check failure is non-fatal */ }

      if (onUploadComplete) onUploadComplete()
    } catch (err) {
      const errMsg = err?.response?.data?.detail || 'Upload failed'
      setFileList((prev) =>
        prev.map((f) => f.status === 'uploading' ? { ...f, status: 'error', error: errMsg } : f)
      )
    } finally {
      setIsUploading(false)
    }
  }

  const pendingCount = fileList.filter((f) => f.status === 'pending').length

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Upload Medical Documents</h3>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-3 p-8 rounded-2xl
          border-2 border-dashed cursor-pointer transition-all duration-150
          ${isDragOver
            ? 'border-blue-400 bg-blue-50 scale-[1.01]'
            : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/40'
          }
        `}
      >
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
          isDragOver ? 'bg-blue-100' : 'bg-white shadow-sm'
        }`}>
          <CloudUpload className={`w-6 h-6 ${isDragOver ? 'text-blue-500' : 'text-slate-400'}`} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-700">
            {isDragOver ? 'Drop files here' : 'Drag & drop files here'}
          </p>
          <p className="text-xs text-slate-400 mt-1">or click to browse · {ACCEPTED_LABEL}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* File list */}
      {fileList.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
          {fileList.map((f, i) => <FileRow key={i} file={f} />)}
        </div>
      )}

      {/* Upload button */}
      {pendingCount > 0 && (
        <button
          onClick={handleUpload}
          disabled={isUploading}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
          ) : (
            <><Upload className="w-4 h-4" /> Upload {pendingCount} file{pendingCount > 1 ? 's' : ''}</>
          )}
        </button>
      )}
    </div>
  )
}
