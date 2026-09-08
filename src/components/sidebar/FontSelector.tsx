'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X, ChevronDown, Check, Loader2 } from 'lucide-react';
import type { FontCategory, Font } from '../../types';
import {
  loadGoogleFont,
  isFontLoaded,
  searchFonts,
  initializeGoogleFonts,
  getAllGoogleFonts,
} from '../../lib/font-loader';

interface FontSelectorProps {
  value: string;
  onChange: (fontFamily: string) => void;
  onPreview?: (fontFamily: string | null) => void;
  className?: string;
}

const CATEGORIES: { value: FontCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sans-serif', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Display' },
  { value: 'handwriting', label: 'Script' },
  { value: 'monospace', label: 'Mono' },
];

const CATEGORY_LABELS: Record<string, string> = {
  'sans-serif': 'Sans',
  serif: 'Serif',
  display: 'Display',
  handwriting: 'Script',
  monospace: 'Mono',
};

const ITEM_HEIGHT = 32;
const VISIBLE_ITEMS = 6;
const BUFFER_ITEMS = 4;

interface FontOptionProps {
  font: Font;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
  style: React.CSSProperties;
}

function FontOption({ font, isSelected, onSelect, onHover, style }: FontOptionProps) {
  useEffect(() => {
    if (!isFontLoaded(font.family)) {
      loadGoogleFont(font.family);
    }
  }, [font.family]);

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onHover}
      style={style}
      className={`absolute w-full px-3 text-left flex items-center justify-between gap-2 text-sm ${
        isSelected ? 'bg-primary-100 text-primary-700 font-medium' : 'hover:bg-slate-100 text-slate-700'
      }`}
    >
      <span className="truncate flex-1" style={{ fontFamily: `"${font.family}", system-ui` }}>
        {font.family}
      </span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[10px] text-slate-400 uppercase tracking-wide">
          {CATEGORY_LABELS[font.category] || font.category}
        </span>
        {isSelected && <Check className="w-3.5 h-3.5 text-primary-600" />}
      </div>
    </button>
  );
}

export function FontSelector({ value, onChange, onPreview, className = '' }: FontSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<FontCategory | 'all'>('all');
  const [availableFonts, setAvailableFonts] = useState<Font[]>(getAllGoogleFonts());
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [dropUp, setDropUp] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 290 && rect.top > spaceBelow);
    }
  }, [isOpen]);

  useEffect(() => {
    let cancelled = false;
    initializeGoogleFonts().then((fonts) => {
      if (!cancelled) {
        setAvailableFonts(fonts);
        setIsLoadingList(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (value) {
      loadGoogleFont(value);
    }
  }, [value]);

  const filteredFonts = useMemo(() => {
    let fonts = availableFonts;
    if (category !== 'all') {
      fonts = fonts.filter((f) => f.category === category);
    }
    if (search.trim()) {
      fonts = searchFonts(search, fonts);
    }
    return fonts;
  }, [search, category, availableFonts]);

  const listHeight = VISIBLE_ITEMS * ITEM_HEIGHT;
  const totalHeight = filteredFonts.length * ITEM_HEIGHT;
  const maxScroll = Math.max(0, totalHeight - listHeight);
  const effectiveScrollTop = Math.min(Math.max(0, scrollTop), maxScroll);
  const startIndex = Math.max(0, Math.floor(effectiveScrollTop / ITEM_HEIGHT) - BUFFER_ITEMS);
  const endIndex = Math.min(
    filteredFonts.length,
    Math.ceil((effectiveScrollTop + listHeight) / ITEM_HEIGHT) + BUFFER_ITEMS
  );
  const visibleFonts = filteredFonts.slice(startIndex, endIndex);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleCategoryChange = useCallback((newCat: FontCategory | 'all') => {
    setCategory(newCat);
    setScrollTop(0);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, []);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    setScrollTop(0);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, []);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setSearch('');
    setScrollTop(0);
    onPreview?.(null);
  }, [onPreview]);

  // Reset or scroll to active font when dropdown opens
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        if (listRef.current) {
          if (value) {
            const idx = filteredFonts.findIndex((f) => f.family === value);
            if (idx >= 0) {
              const target = Math.max(0, (idx - 2) * ITEM_HEIGHT);
              listRef.current.scrollTop = target;
              setScrollTop(target);
              return;
            }
          }
          listRef.current.scrollTop = 0;
          setScrollTop(0);
        }
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, closeDropdown]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const handleSelect = (font: Font) => {
    loadGoogleFont(font.family);
    onChange(font.family);
    closeDropdown();
  };

  return (
    <div ref={containerRef} className={`relative ${isOpen ? 'z-50' : ''} ${className}`}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-slate-600">Font</label>
        <span className="text-xs font-medium text-slate-400">
          {isLoadingList ? 'Loading fonts...' : `${availableFonts.length} available`}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 text-sm text-left bg-white border flex items-center justify-between gap-2 transition-colors ${
          isOpen
            ? dropUp
              ? 'rounded-t-none rounded-b-lg border-slate-400 border-t-slate-200 shadow-sm'
              : 'rounded-b-none rounded-t-lg border-slate-400 border-b-slate-200 shadow-sm'
            : 'rounded-lg border-slate-200 hover:border-slate-300 focus:outline-none focus:border-slate-400'
        }`}
      >
        <span className="flex-1 truncate" style={{ fontFamily: value ? `"${value}", system-ui` : 'inherit' }}>
          {value || 'Select font...'}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute z-[100] left-0 right-0 bg-white shadow-xl overflow-hidden ${
            dropUp
              ? 'bottom-full mb-0 rounded-t-lg rounded-b-none border-x border-t border-slate-400'
              : 'top-full mt-0 rounded-b-lg rounded-t-none border-x border-b border-slate-400'
          }`}
          onMouseLeave={() => onPreview?.(null)}
        >
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search fonts..."
                className="w-full pl-8 pr-8 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-0 focus:border-slate-400"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="p-2 border-b border-slate-100 flex flex-wrap gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => handleCategoryChange(cat.value)}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                  category === cat.value ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div
            ref={listRef}
            className="overflow-y-auto"
            style={{ height: Math.min(listHeight, Math.max(ITEM_HEIGHT, totalHeight)) }}
            onScroll={handleScroll}
          >
            {filteredFonts.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">No fonts found</div>
            ) : (
              <div style={{ height: totalHeight, position: 'relative' }}>
                {visibleFonts.map((font, i) => (
                  <FontOption
                    key={font.family}
                    font={font}
                    isSelected={font.family === value}
                    onSelect={() => handleSelect(font)}
                    onHover={() => onPreview?.(font.family)}
                    style={{
                      top: (startIndex + i) * ITEM_HEIGHT,
                      height: ITEM_HEIGHT,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
