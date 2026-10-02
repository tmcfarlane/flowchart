import { useState, useEffect, useId, useMemo, useRef } from 'react'
import './ImagePicker.css'
import { diagramSvgModules } from '../utils/azureIconIds'
import { DIAGRAM_ICONS } from '../shared/diagramIcons'
import { IMAGE_UPLOAD_ACCEPT, prepareImageUpload } from '../utils/imageUpload'

interface ImagePickerProps {
  isOpen: boolean
  onClose: () => void
  onSelectImage: (imageUrl: string, label: string) => void
}

type Tab = 'upload' | 'library'

interface SvgAsset {
  path: string
  url: string
  folder: string
  name: string
  displayName: string
}

// Convert filename to readable display name
function formatDisplayName(filename: string): string {
  // Remove number prefix like "00028-"
  let name = filename.replace(/^\d+-/, '')
  // Remove "icon-service-" prefix
  name = name.replace(/^icon-service-/i, '')
  // Replace hyphens and underscores with spaces
  name = name.replace(/[-_]/g, ' ')
  // Clean up any double spaces
  name = name.replace(/\s+/g, ' ').trim()
  return name
}

// Format folder name for display
function formatFolderName(folder: string): string {
  // Remove number prefixes like "01-", "02-"
  let name = folder.replace(/^\d+-/, '')
  // Replace hyphens and underscores with spaces
  name = name.replace(/[-_]/g, ' ')
  // Capitalize first letter of each word
  name = name.replace(/\b\w/g, (c) => c.toUpperCase())
  return name
}

interface SelectedAsset {
  asset: SvgAsset | null
  imageUrl: string
  label: string
  isUploaded: boolean
  notice?: string
}

// List of popular Azure service icon names (partial matches work)
const POPULAR_SERVICES = [
  'App-Services',
  'Function-Apps',
  'Key-Vaults',
  'Storage-Accounts',
  'Virtual-Machine',
  'SQL-Database',
  'Azure-Cosmos-DB',
  'Kubernetes-Services',
  'API-Management-Services',
  'Application-Insights',
  'Load-Balancers',
  'Virtual-Networks',
  'Azure-Service-Bus',
  'Logic-Apps',
  'Application-Gateways',
  'Event-Hubs',
  'Cache-Redis',
  'Entra-ID',
  'Container-Instances',
  'Front-Door',
]

// Check if an asset is a popular service
function isPopularService(assetName: string): boolean {
  return POPULAR_SERVICES.some((service) =>
    assetName.toLowerCase().includes(service.toLowerCase().replace(/-/g, '-'))
  )
}

function ImagePicker({ isOpen, onClose, onSelectImage }: ImagePickerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('library')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<string>('popular')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<SelectedAsset | null>(null)
  const [editableLabel, setEditableLabel] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const labelId = useId()
  const uploadId = useId()
  const categoriesId = useId()
  const uploadGeneration = useRef(0)
  const uploadController = useRef<AbortController | null>(null)
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen

  const cancelUpload = () => {
    uploadGeneration.current += 1
    uploadController.current?.abort()
    uploadController.current = null
    setIsUploading(false)
  }

  useEffect(() => {
    if (!isOpen) {
      uploadGeneration.current += 1
      uploadController.current?.abort()
      uploadController.current = null
      setIsUploading(false)
    }
  }, [isOpen])
  useEffect(() => () => {
    uploadGeneration.current += 1
    uploadController.current?.abort()
  }, [])

  const svgAssets = useMemo<SvgAsset[]>(() => {
    const azureModules = import.meta.glob('/assets/icons/**/*.svg', {
      eager: true,
      import: 'default',
    })

    const metadata = new Map(DIAGRAM_ICONS.map((icon) => [icon.path, icon]))
    const modules = { ...azureModules, ...diagramSvgModules }
    return Object.entries(modules).map(([path, url]) => {
      const original = metadata.get(path)
      const parts = path.split('/')
      // Get the folder (parent directory of the SVG)
      const folder = original ? 'Flowchart originals' : parts[parts.length - 2] || 'other'
      const name = parts[parts.length - 1].replace('.svg', '')
      const displayName = original?.name ?? formatDisplayName(name)

      return {
        path,
        url: String(url),
        folder,
        name,
        displayName,
      }
    })
  }, [])

  const folders = useMemo(() => {
    const uniqueFolders = Array.from(new Set(svgAssets.map((a) => a.folder)))
    // Sort alphabetically by formatted display name
    uniqueFolders.sort((a, b) => formatFolderName(a).localeCompare(formatFolderName(b)))
    // 'popular' at top, then 'all', then sorted categories
    return ['popular', 'all', ...uniqueFolders]
  }, [svgAssets])

  const filteredAssets = useMemo(() => {
    let assets = svgAssets

    if (selectedFolder === 'popular' && !searchQuery.trim()) {
      // Filter to popular services and deduplicate by name
      const popularAssets = assets.filter((a) => isPopularService(a.name))
      // Deduplicate by name (keep the first occurrence)
      const seenNames = new Set<string>()
      assets = popularAssets.filter((a) => {
        if (seenNames.has(a.name)) return false
        seenNames.add(a.name)
        return true
      })
    } else if (selectedFolder !== 'all' && selectedFolder !== 'popular') {
      assets = assets.filter((a) => a.folder === selectedFolder)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      assets = assets.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          a.displayName.toLowerCase().includes(query) ||
          a.folder.toLowerCase().includes(query)
      )
    }

    return assets
  }, [svgAssets, selectedFolder, searchQuery])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Allow choosing the same file after a read/decode failure.
    e.target.value = ''
    if (!file) return
    cancelUpload()
    setUploadError(null)
    setIsUploading(true)
    const generation = uploadGeneration.current
    const controller = new AbortController()
    uploadController.current = controller
    try {
      const uploaded = await prepareImageUpload(file, controller.signal)
      if (generation !== uploadGeneration.current || !isOpenRef.current) return
      setSelectedAsset({ asset: null, ...uploaded, isUploaded: true })
      setEditableLabel(uploaded.label)
    } catch (error) {
      if (generation !== uploadGeneration.current || !isOpenRef.current || controller.signal.aborted) return
      setUploadError(error instanceof Error ? error.message : 'This image could not be opened. Try another file.')
    } finally {
      if (generation === uploadGeneration.current) {
        uploadController.current = null
        setIsUploading(false)
      }
    }
  }

  const handleSelectLibraryItem = (asset: SvgAsset) => {
    cancelUpload()
    setUploadError(null)
    setSelectedAsset({
      asset,
      imageUrl: asset.url,
      label: asset.displayName,
      isUploaded: false,
    })
    setEditableLabel(asset.displayName)
  }

  const handleConfirmSelection = () => {
    if (selectedAsset) {
      onSelectImage(selectedAsset.imageUrl, editableLabel || selectedAsset.label)
      handleClose()
    }
  }

  const handleBackToLibrary = () => {
    cancelUpload()
    setUploadError(null)
    setSelectedAsset(null)
    setEditableLabel('')
  }

  const handleClose = () => {
    cancelUpload()
    setUploadError(null)
    setActiveTab('library')
    setSearchQuery('')
    setSelectedFolder('popular')
    setSelectedAsset(null)
    setEditableLabel('')
    setIsDropdownOpen(false)
    onClose()
  }

  const handleFolderSelect = (folder: string) => {
    setSelectedFolder(folder)
    setIsDropdownOpen(false)
    dropdownRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }

  const keyboardState = useRef({ selectedAsset, isDropdownOpen, handleBackToLibrary, handleClose })
  keyboardState.current = { selectedAsset, isDropdownOpen, handleBackToLibrary, handleClose }
  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const controls = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? []).filter((element) => {
      const style = getComputedStyle(element)
      return !element.closest('[hidden], [inert], [aria-hidden="true"]') && style.display !== 'none' && style.visibility !== 'hidden' && !(element instanceof HTMLInputElement && element.type === 'hidden')
    })
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        const current = keyboardState.current
        if (current.isDropdownOpen) {
          setIsDropdownOpen(false)
          dropdownRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
        } else if (current.selectedAsset) current.handleBackToLibrary()
        else current.handleClose()
      } else if (event.key === 'Tab') {
        const focusable = controls()
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (!first || !last) return
        if (!dialogRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault()
          const target = event.shiftKey ? last : first
          target.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) controls()[0]?.focus()
    }
    document.addEventListener('keydown', handleKey, true)
    document.addEventListener('focusin', containFocus, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      document.removeEventListener('focusin', containFocus, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const initial = selectedAsset ? '.preview-label-input' : '.library-search, .upload-label'
    dialogRef.current?.querySelector<HTMLElement>(initial)?.focus()
  }, [isOpen, selectedAsset])

  if (!isOpen) return null

  // Preview mode - show selected image with editable label
  if (selectedAsset) {
    return (
      <div className="image-picker-overlay" onClick={handleClose}>
        <div ref={dialogRef} className="image-picker-dialog preview-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
          <div className="image-picker-header">
            <button
              className="image-picker-back"
              onClick={handleBackToLibrary}
              aria-label="Back"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Back</span>
            </button>
            <h2 id={titleId} className="image-picker-title">Customize Icon</h2>
            <button
              className="image-picker-close"
              onClick={handleClose}
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          <div className="preview-content">
            <div className="preview-card">
              <div className="preview-card-icon">
                <img src={selectedAsset.imageUrl} alt={selectedAsset.label} />
              </div>
              <span className="preview-card-label">{editableLabel || selectedAsset.label}</span>
            </div>

            <div className="preview-details">
              <label htmlFor={labelId} className="preview-label-title">Label</label>
              <input
                id={labelId}
                type="text"
                className="preview-label-input"
                value={editableLabel}
                onChange={(e) => setEditableLabel(e.target.value)}
                placeholder="Enter a label for this icon"
                maxLength={500}
              />
              <p className="preview-hint">This label will appear below the icon on your flowchart</p>
              {selectedAsset.notice && <p className="upload-notice" role="note">{selectedAsset.notice}</p>}
            </div>
          </div>

          <div className="preview-actions">
            <button
              className="preview-cancel"
              onClick={handleBackToLibrary}
            >
              Cancel
            </button>
            <button
              className="preview-confirm"
              onClick={handleConfirmSelection}
            >
              Add to Flowchart
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="image-picker-overlay" onClick={handleClose}>
      <div ref={dialogRef} className="image-picker-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="image-picker-header">
          <h2 id={titleId} className="image-picker-title">Add Image</h2>
          <button
            className="image-picker-close"
            onClick={handleClose}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <div className="image-picker-tabs" role="group" aria-label="Image source">
          <button
            className={`image-picker-tab ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => { cancelUpload(); setUploadError(null); setActiveTab('library') }}
            aria-pressed={activeTab === 'library'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 4.5V14a2 2 0 01-2 2H4a2 2 0 01-2-2V2a2 2 0 012-2h5.5L14 4.5zm-3 0A1.5 1.5 0 019.5 3V1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V4.5h-2z" />
            </svg>
            Icon library
          </button>
          <button
            className={`image-picker-tab ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => { cancelUpload(); setUploadError(null); setActiveTab('upload') }}
            aria-pressed={activeTab === 'upload'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z" />
              <path d="M7.646 1.146a.5.5 0 01.708 0l3 3a.5.5 0 01-.708.708L8.5 2.707V11.5a.5.5 0 01-1 0V2.707L5.354 4.854a.5.5 0 11-.708-.708l3-3z" />
            </svg>
            Upload
          </button>
        </div>

        <div className="image-picker-content">
          {activeTab === 'library' ? (
            <div className="library-panel">
              <div className="library-controls">
                <div className="library-search-wrapper">
                  <svg className="library-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85a1.007 1.007 0 00-.115-.1zM12 6.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z" />
                  </svg>
                  <input
                    type="text"
                    className="library-search"
                    placeholder="Search services, concepts, or dream symbols…"
                    aria-label="Search icon library"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="library-dropdown" ref={dropdownRef}>
                  <button
                    className="library-dropdown-trigger"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    type="button"
                    aria-expanded={isDropdownOpen}
                    aria-controls={categoriesId}
                    aria-label="Icon category"
                  >
                    <span className="library-dropdown-text">
                      {selectedFolder === 'popular' && (
                        <svg className="library-dropdown-star" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      )}
                      {selectedFolder === 'popular' ? 'Most Popular' : selectedFolder === 'all' ? 'All Categories' : formatFolderName(selectedFolder)}
                    </span>
                    <svg
                      className={`library-dropdown-arrow ${isDropdownOpen ? 'open' : ''}`}
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="currentColor"
                    >
                      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </button>

                  {isDropdownOpen && (
                    <div id={categoriesId} className="library-dropdown-menu" role="group" aria-label="Icon categories">
                      {folders.map((folder) => (
                        <button
                          key={folder}
                          className={`library-dropdown-item ${selectedFolder === folder ? 'selected' : ''} ${folder === 'popular' ? 'popular-item' : ''}`}
                          onClick={() => handleFolderSelect(folder)}
                        >
                          <span className="library-dropdown-item-label">
                            {folder === 'popular' && (
                              <svg className="library-dropdown-star" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              </svg>
                            )}
                            {folder === 'popular' ? 'Most Popular' : folder === 'all' ? 'All Categories' : formatFolderName(folder)}
                          </span>
                          {selectedFolder === folder && (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                              <path d="M11.854 4.146a.5.5 0 010 .708l-5.5 5.5a.5.5 0 01-.708 0l-2.5-2.5a.5.5 0 11.708-.708L6 9.293l5.146-5.147a.5.5 0 01.708 0z" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="library-grid">
                {filteredAssets.length === 0 ? (
                  <div className="library-empty">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                      <path d="M24 4L4 14V34L24 44L44 34V14L24 4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
                      <path d="M4 14L24 24M24 24L44 14M24 24V44" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
                    </svg>
                    <span>No icons found</span>
                    <span className="library-empty-hint">Try a different search term or category</span>
                  </div>
                ) : (
                  filteredAssets.map((asset) => (
                    <button
                      key={asset.path}
                      className="library-item"
                      onClick={() => handleSelectLibraryItem(asset)}
                      title={`${formatFolderName(asset.folder)} - ${asset.displayName}`}
                      aria-label={asset.displayName}
                    >
                      <div className="library-item-icon">
                        <img src={asset.url} alt={asset.displayName} />
                      </div>
                      <span className="library-item-name">{asset.displayName}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="library-footer">
                <span className="library-footer-count">
                  {filteredAssets.length} icon{filteredAssets.length !== 1 ? 's' : ''}
                </span>
                <a
                  href="https://learn.microsoft.com/en-us/azure/architecture/icons/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="library-footer-source"
                >
                  Azure + Flowchart originals
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M3.5 3a.5.5 0 00-.5.5v5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V6.5a.5.5 0 011 0V8.5A1.5 1.5 0 018.5 10h-5A1.5 1.5 0 012 8.5v-5A1.5 1.5 0 013.5 2H5.5a.5.5 0 010 1H3.5z" />
                    <path d="M6.5 1a.5.5 0 000 1H9.293L5.146 6.146a.5.5 0 10.708.708L10 2.707V5.5a.5.5 0 001 0v-4a.5.5 0 00-.5-.5h-4z" />
                  </svg>
                </a>
              </div>
            </div>
          ) : (
            <div className="upload-panel">
              <div className="upload-area" aria-busy={isUploading}>
                <input
                  type="file"
                  id={uploadId}
                  accept={IMAGE_UPLOAD_ACCEPT}
                  onChange={handleFileUpload}
                  className="upload-input"
                />
                <label htmlFor={uploadId} className="upload-label" role="button" tabIndex={0} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    dialogRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click()
                  }
                }}>
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 48 48"
                    fill="none"
                    className="upload-icon"
                  >
                    <path
                      d="M24 32V16M24 16L18 22M24 16L30 22"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8 40H40C42.2091 40 44 38.2091 44 36V12C44 9.79086 42.2091 8 40 8H8C5.79086 8 4 9.79086 4 12V36C4 38.2091 5.79086 40 8 40Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="upload-text">
                    Click to upload an image
                  </span>
                  <span className="upload-hint">PNG, JPEG, GIF, WebP, AVIF, or SVG · up to 5 MB</span>
                </label>
              </div>
              {isUploading && <p className="upload-progress" role="status">Opening your image…</p>}
              {uploadError && <p className="upload-error" role="alert">{uploadError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ImagePicker
