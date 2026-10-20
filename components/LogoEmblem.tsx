'use client';

import React from 'react';
import Image from 'next/image';

interface LogoEmblemProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  academicYear?: string;
}

export const LogoEmblem: React.FC<LogoEmblemProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
  academicYear = '2026/2027'
}) => {
  const iconSize = size === 'sm' ? 32 : size === 'lg' ? 48 : 40;

  return (
    <div className={`flex items-center gap-2.5 ${className}`} id="app-logo-emblem">
      {/* App Icon — Book + Crescent */}
      <Image
        src="/pwa-192x192.png" alt="معين" width={iconSize}
        height={iconSize}
        className="rounded-lg shrink-0" />

      {/* Typography */}
      <div className="flex flex-col text-right leading-tight">
        <span className="text-sm font-bold text-slate-900">معين</span>
        {showSubtitle && (
          <span className="text-[11px] text-[var(--text-muted)]">
            العلوم الإسلامية • {academicYear}
          </span>
        )}
      </div>
    </div>
  );
};
