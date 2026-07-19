import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { adminUploadFormAsset } from '../../api/forms';
import {
  formatTimestamp,
  parseTimestamp,
  parseYouTubeId,
  resolveAssetUrl,
  youTubeEmbedUrl,
} from '../../lib/flowGraph';
import type { ActionType, FlowAction } from '../../lib/flowTypes';
import { useToast } from '../../context/ToastContext';
import { Button, FieldLabel, Input, Select } from '../ui';
import { inputClasses } from '../ui/Input';
import { cn } from '../../utils/cn';

const ACTION_TYPE_OPTIONS: { value: ActionType; label: string }[] = [
  { value: 'none', label: 'No action' },
  { value: 'notify', label: 'Send text notification' },
  { value: 'youtube', label: 'Play YouTube tutorial' },
  { value: 'video', label: 'Play uploaded video' },
  { value: 'info', label: 'Show information' },
];

export interface ActionEditorProps {
  action: FlowAction;
  onChange: (action: FlowAction) => void;
}

/**
 * Edits an option's coaching action. Mount with `key={option.id}` so the
 * local timestamp text state resets when a different option is edited.
 */
const ActionEditor: React.FC<ActionEditorProps> = ({ action, onChange }) => {
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [startText, setStartText] = useState(() => formatTimestamp(action.startSeconds));
  const [endText, setEndText] = useState(() => formatTimestamp(action.endSeconds));
  const [startError, setStartError] = useState('');
  const [endError, setEndError] = useState('');

  // Patches must merge into the LATEST action — the video upload resolves after
  // an await, and per-keystroke edits made meanwhile would otherwise be wiped
  // by a stale closure over the `action` prop.
  const actionRef = useRef(action);
  actionRef.current = action;
  const patch = (p: Partial<FlowAction>) => onChange({ ...actionRef.current, ...p });

  // Timestamps commit on BLUR, not per keystroke — committing prefixes like
  // "1" while typing "1:20" would silently store a wrong clip window.
  const commitTimestamp = (which: 'start' | 'end') => {
    const text = which === 'start' ? startText : endText;
    const setError = which === 'start' ? setStartError : setEndError;
    if (!text.trim()) {
      setError('');
      patch(which === 'start' ? { startSeconds: null } : { endSeconds: null });
      return;
    }
    const seconds = parseTimestamp(text);
    if (seconds == null) {
      // Clear the stored value too, so an overlooked typo never publishes a
      // stale clip window that disagrees with what the field shows.
      setError('Use a format like 1:23');
      patch(which === 'start' ? { startSeconds: null } : { endSeconds: null });
      return;
    }
    setError('');
    patch(which === 'start' ? { startSeconds: seconds } : { endSeconds: seconds });
  };

  const handleVideoFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await adminUploadFormAsset(file);
      patch({ url: res.url });
    } catch {
      showToast('Could not upload the video', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const embed =
    action.type === 'youtube'
      ? youTubeEmbedUrl(action.url, action.startSeconds, action.endSeconds)
      : null;
  const youtubeUrlError =
    action.type === 'youtube' && action.url.trim() !== '' && !parseYouTubeId(action.url)
      ? 'Not a recognisable YouTube link'
      : undefined;

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel size="sm">On select</FieldLabel>
        <Select value={action.type} onChange={e => patch({ type: e.target.value as ActionType })}>
          {ACTION_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {(action.type === 'notify' || action.type === 'info') && (
        <div>
          <FieldLabel size="sm">
            {action.type === 'notify' ? 'Notification message' : 'Information text'}
          </FieldLabel>
          <textarea
            rows={2}
            className={cn(inputClasses(), 'resize-y')}
            value={action.message}
            onChange={e => patch({ message: e.target.value })}
            placeholder="What should the learner read?"
          />
        </div>
      )}

      {action.type === 'youtube' && (
        <>
          <div>
            <FieldLabel size="sm">YouTube link</FieldLabel>
            <Input
              value={action.url}
              onChange={e => patch({ url: e.target.value })}
              placeholder="https://youtube.com/watch?v=…"
              error={youtubeUrlError}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel size="sm">Start at</FieldLabel>
              <Input
                value={startText}
                placeholder="0:30"
                error={startError || undefined}
                onChange={e => setStartText(e.target.value)}
                onBlur={() => commitTimestamp('start')}
              />
            </div>
            <div>
              <FieldLabel size="sm">End at</FieldLabel>
              <Input
                value={endText}
                placeholder="2:45"
                error={endError || undefined}
                onChange={e => setEndText(e.target.value)}
                onBlur={() => commitTimestamp('end')}
              />
            </div>
          </div>
          {embed && (
            <iframe
              src={embed}
              title="YouTube preview"
              className="aspect-video w-full rounded-lg border border-border"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </>
      )}

      {action.type === 'video' && (
        <>
          <div>
            <FieldLabel size="sm">Video file</FieldLabel>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={uploading}
                iconLeft={<Upload className="size-4" />}
                onClick={() => fileRef.current?.click()}
              >
                {action.url ? 'Replace file' : 'Upload file'}
              </Button>
              <span className="text-[11px] text-ink-faint">MP4, WebM or MP3 · max 25 MB</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/webm,audio/mpeg"
              className="hidden"
              onChange={e => handleVideoFile(e.target.files?.[0])}
            />
          </div>
          <div>
            <FieldLabel size="sm">…or a direct URL</FieldLabel>
            <Input
              value={action.url}
              onChange={e => patch({ url: e.target.value })}
              placeholder="https://… or /uploads/…"
            />
          </div>
          {action.url.trim() !== '' && (
            <video
              key={action.url}
              controls
              src={resolveAssetUrl(action.url)}
              className="w-full rounded-lg border border-border bg-cream-950"
            />
          )}
        </>
      )}

      {(action.type === 'youtube' || action.type === 'video') && (
        <div>
          <FieldLabel size="sm">Caption (optional)</FieldLabel>
          <Input
            value={action.message}
            onChange={e => patch({ message: e.target.value })}
            placeholder="Shown alongside the video"
          />
        </div>
      )}
    </div>
  );
};

export default ActionEditor;
