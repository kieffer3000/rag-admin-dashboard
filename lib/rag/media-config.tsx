import {
  Youtube,
  Image as ImageIcon,
  AudioLines,
  FileText,
  Type,
  Globe,
  type LucideIcon
} from 'lucide-react';
import { MediaType } from './types';

export interface MediaTypeMeta {
  type: MediaType;
  label: string;
  plural: string;
  icon: LucideIcon;
  /** Tailwind text color class. */
  text: string;
  /** Tailwind background tint class. */
  tint: string;
  /** Solid background for icon chips. */
  solid: string;
  /** CSS var name for the accent (used inline where needed). */
  cssVar: string;
}

export const MEDIA_TYPES: Record<MediaType, MediaTypeMeta> = {
  youtube: {
    type: 'youtube',
    label: 'YouTube',
    plural: 'YouTube',
    icon: Youtube,
    text: 'text-red-600',
    tint: 'bg-red-50',
    solid: 'bg-red-500',
    cssVar: 'var(--m-youtube)'
  },
  image: {
    type: 'image',
    label: 'Image',
    plural: 'Images',
    icon: ImageIcon,
    text: 'text-purple-600',
    tint: 'bg-purple-50',
    solid: 'bg-purple-500',
    cssVar: 'var(--m-image)'
  },
  audio: {
    type: 'audio',
    label: 'Audio',
    plural: 'Audio',
    icon: AudioLines,
    text: 'text-orange-600',
    tint: 'bg-orange-50',
    solid: 'bg-orange-500',
    cssVar: 'var(--m-audio)'
  },
  document: {
    type: 'document',
    label: 'Document',
    plural: 'Documents',
    icon: FileText,
    text: 'text-blue-600',
    tint: 'bg-blue-50',
    solid: 'bg-blue-500',
    cssVar: 'var(--m-document)'
  },
  text: {
    type: 'text',
    label: 'Text',
    plural: 'Text',
    icon: Type,
    text: 'text-slate-600',
    tint: 'bg-slate-100',
    solid: 'bg-slate-500',
    cssVar: 'var(--m-text)'
  },
  website: {
    type: 'website',
    label: 'Website',
    plural: 'Websites',
    icon: Globe,
    text: 'text-teal-600',
    tint: 'bg-teal-50',
    solid: 'bg-teal-500',
    cssVar: 'var(--m-website)'
  }
};

export const MEDIA_TYPE_ORDER: MediaType[] = [
  'document',
  'youtube',
  'audio',
  'image',
  'text',
  'website'
];
