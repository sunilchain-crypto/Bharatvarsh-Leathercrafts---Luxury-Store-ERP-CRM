import React from 'react';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  lightText?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ className = '', size = 'md', lightText = false }) => {
  const iconSize = size === 'sm' ? 32 : size === 'lg' ? 56 : 42;

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Attached Circular Leathercraft Crest Logo */}
      <div
        className="relative flex items-center justify-center rounded-full overflow-hidden border border-[#C5A059]/40 shadow-sm bg-[#FAF7F2] shrink-0"
        style={{ width: iconSize, height: iconSize }}
      >
        <img
          src="/assets/aistudio/Circular_with_Stitch_and_ring_Bharatvarsh_2405b0e7.png"
          alt="Bharatvarsh Leathercrafts LLP Logo"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Brand Wordmark */}
      <div className="flex flex-col text-left">
        <span
          className={`font-display font-bold tracking-[0.15em] uppercase text-sm sm:text-base leading-none whitespace-nowrap ${
            lightText ? 'text-[#FAF7F2]' : 'text-[#16120E]'
          }`}
        >
          Bharatvarsh
        </span>
        <span
          className={`text-[9px] tracking-[0.22em] uppercase font-medium leading-tight mt-1 whitespace-nowrap ${
            lightText ? 'text-[#C5A059]' : 'text-[#8B4513]'
          }`}
        >
          Leathercrafts LLP
        </span>
      </div>
    </div>
  );
};
