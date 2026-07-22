import React, { useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, Plus, X } from 'lucide-react';
import { adminUploadFormAsset } from '../../api/forms';
import { resolveAssetUrl } from '../../lib/flowGraph';
import type { FlowMedia } from '../../lib/flowTypes';
import { useToast } from '../../context/ToastContext';
import { FieldLabel, Input } from '../ui';
import { cn } from '../../utils/cn';

export interface MediaPickerProps {
  media: FlowMedia[];
  onChange: (media: FlowMedia[]) => void;
  label?: string;
}

const typeForUrl = (url: string): FlowMedia['type'] =>
  url.trim().toLowerCase().endsWith('.gif') ? 'gif' : 'image';

/** Thumbnails of an option's images/GIFs with upload + paste-a-URL adders. */
const MediaPicker: React.FC<MediaPickerProps> = ({ media, onChange, label = 'Images' }) => {
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrlRow, setShowUrlRow] = useState(false);
  const [url, setUrl] = useState('');
  // The upload resolves after an await — read the media list through a ref so
  // edits made while the upload was in flight aren't clobbered by a stale closure.
  const mediaRef = useRef(media);
  mediaRef.current = media;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await adminUploadFormAsset(file);
      const type: FlowMedia['type'] = file.type === 'image/gif' ? 'gif' : typeForUrl(res.url);
      onChange([...mediaRef.current, { type, url: res.url }]);
    } catch {
      showToast('Could not upload the image', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onChange([...media, { type: typeForUrl(trimmed), url: trimmed }]);
    setUrl('');
    setShowUrlRow(false);
  };

  const tileBtn =
    'flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed cursor-pointer transition-colors';

  return (
    <div>
      <FieldLabel size="sm">{label}</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        {media.map((m, i) => (
          <div
            key={`${m.url}-${i}`}
            className="group relative size-14 overflow-hidden rounded-lg border border-border bg-surface-sunken"
          >
            <img src={resolveAssetUrl(m.url)} alt="" className="size-full object-cover" />
            {m.type === 'gif' && (
              <span className="absolute bottom-0.5 left-0.5 rounded bg-cream-950/70 px-1 text-[9px] font-bold text-white">
                GIF
              </span>
            )}
            <button
              type="button"
              title="Remove image"
              onClick={() => onChange(media.filter((_, mi) => mi !== i))}
              className="absolute right-0.5 top-0.5 hidden size-4.5 items-center justify-center rounded-full bg-cream-950/70 text-white group-hover:flex cursor-pointer"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}

        <button
          type="button"
          title="Upload an image or GIF"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className={cn(
            tileBtn,
            'border-border-strong/70 text-ink-faint hover:border-primary hover:text-primary-ink',
            uploading && 'pointer-events-none opacity-70',
          )}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4.5" />}
        </button>
        <button
          type="button"
          title="Add an image by URL"
          onClick={() => setShowUrlRow(v => !v)}
          className={cn(
            tileBtn,
            showUrlRow
              ? 'border-primary text-primary-ink'
              : 'border-border-strong/70 text-ink-faint hover:border-primary hover:text-primary-ink',
          )}
        >
          <Link2 className="size-4.5" />
        </button>
      </div>

      {showUrlRow && (
        <div className="mt-2 flex items-center gap-1.5">
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://… image or .gif URL"
            onKeyDown={e => e.key === 'Enter' && addUrl()}
          />
          <button
            type="button"
            title="Add image URL"
            onClick={addUrl}
            className="flex size-9.5 shrink-0 items-center justify-center rounded-lg border border-border-strong/60 text-ink-muted hover:border-primary hover:text-primary-ink cursor-pointer"
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.gif"
        className="hidden"
        onChange={e => handleFile(e.target.files?.[0])}
      />
    </div>
  );
};

export default MediaPicker;
