import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { RoboCorpo, RoboEstado, RoboGenero } from "@/lib/robo-estado";
import "./robo-status.css";

/** The API robo-avatar.js attaches to each <svg> it starts. */
export interface RoboAvatarApi {
  acordar(on?: boolean): void;
  acenar(side: "esquerda" | "direita"): void;
}

export type RoboSvg = SVGSVGElement & { nbAvatar?: RoboAvatarApi };

declare global {
  interface Window {
    nbAvatarInit?: (svg: SVGSVGElement) => void;
    __nbVarrendo?: boolean;
  }
}

let engine: Promise<void> | null = null;

function loadEngine(): Promise<void> {
  if (window.nbAvatarInit) return Promise.resolve();
  engine ??= new Promise<void>((resolve, reject) => {
    // robo-avatar.js otherwise watches every DOM insertion in the document for avatars; each one is started below instead.
    window.__nbVarrendo = true;
    const script = document.createElement("script");
    script.src = "/robo-avatar.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      engine = null;
      script.remove();
      reject(new Error("robo-avatar.js did not load"));
    };
    document.head.appendChild(script);
  });
  return engine;
}

export interface RoboAvatarProps {
  corpo: RoboCorpo;
  genero: RoboGenero;
  estado: RoboEstado;
  ativo?: boolean;
  casca: string;
  luz: string;
  roupa?: string;
  size?: number;
  label?: string;
}

export const RoboAvatar = forwardRef<RoboSvg | null, RoboAvatarProps>(function RoboAvatar(
  { corpo, genero, estado, ativo = false, casca, luz, roupa, size = 44, label },
  ref,
) {
  const svg = useRef<RoboSvg>(null);
  useImperativeHandle<RoboSvg | null, RoboSvg | null>(ref, () => svg.current, []);
  useEffect(() => {
    let alive = true;
    loadEngine().then(() => {
      if (alive && svg.current?.isConnected) window.nbAvatarInit?.(svg.current);
    }, () => {});
    return () => { alive = false; };
  }, []);
  const style: CSSProperties & Record<`--nb-${string}`, string> = { "--nb-casca": casca, "--nb-luz": luz };
  if (roupa) style["--nb-roupa"] = roupa;
  return (
    <svg
      ref={svg}
      className="nb-avatar"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      data-corpo={corpo}
      data-genero={genero}
      data-estado={estado}
      data-ativo={ativo ? "sim" : undefined}
      style={style}
      role="img"
      aria-label={label}
    />
  );
});

const STATUS_LABEL: Record<RoboEstado, LocaleKey> = {
  online: "model.ready",
  trabalhando: "chat.activity.working",
  alerta: "sidebar.preview.waiting",
  ausente: "vm.state.sleeping",
  offline: "vm.state.stopped",
};

export function StatusDot({ estado, className }: { estado: RoboEstado; className?: string }) {
  const label = t(STATUS_LABEL[estado]);
  return <span className={cn("nb-dot", className)} data-estado={estado} data-testid="status-dot" role="img" title={label} aria-label={label} />;
}
