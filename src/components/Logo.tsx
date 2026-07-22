import { useSiteConfig } from "@/lib/customization";

interface LogoProps {
  text?: string;
  size?: "sm" | "md" | "lg";
  showDot?: boolean;
  dotColor?: string;
  suffixClassName?: string;
  className?: string;
}

const sizeClasses = {
  sm: "text-2xl md:text-3xl",
  md: "text-3xl md:text-4xl",
  lg: "text-4xl md:text-5xl",
};

export default function Logo({
  text,
  size = "md",
  showDot = true,
  dotColor = "#ff5e00",
  suffixClassName = "text-white/95",
  className = "",
}: LogoProps) {
  const cfg = useSiteConfig();
  const prefix = text ? text : cfg.brandPrefix;
  const suffix = text ? "" : cfg.brandSuffix;

  return (
    <span
      className={`group inline-flex items-end leading-none select-none ${className}`}
      aria-label={`${prefix}${suffix}`}
    >
      <span
        className={`logo-text ${sizeClasses[size]} transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:-translate-y-px group-hover:drop-shadow-[0_0_24px_rgba(255,94,0,0.75)]`}
      >
        {prefix}
      </span>
      {showDot && (
        <span
          className="mb-1.5 h-2 w-2 rounded-full animate-pulse"
          style={{
            backgroundColor: dotColor,
            boxShadow: `0 0 10px 2px ${dotColor}`,
          }}
        />
      )}
      {suffix && (
        <span
          className={`logo-text logo-text-suffix ${sizeClasses[size]} ml-0.5 transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:-translate-y-px ${suffixClassName}`}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
