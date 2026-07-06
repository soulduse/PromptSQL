import { ReactNode, RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./Icons";

/**
 * 공용 모달 셸 — 오버레이·중앙 정렬·portal·ESC(스택 최상단만)·
 * focus trap·scroll lock·포커스 복원을 한곳에서 책임진다.
 *
 * 콘텐츠 레이아웃은 children에 자유롭게 두고, title/footer를 주면
 * 표준 헤더/푸터(px-6 py-4 + divider)를 렌더한다.
 */

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
export type ModalTone = "default" | "danger";

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
};

// ─── 모달 스택: ESC는 가장 위에 열린 모달만 닫는다 ───
const modalStack: symbol[] = [];

function pushModal(id: symbol) {
  modalStack.push(id);
}

function removeModal(id: symbol) {
  const idx = modalStack.indexOf(id);
  if (idx >= 0) modalStack.splice(idx, 1);
}

function isTopModal(id: symbol): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1] === id;
}

// ─── scroll lock: 열린 모달이 하나라도 있으면 body 스크롤 잠금 ───
let scrollLockCount = 0;

function lockScroll() {
  if (scrollLockCount === 0) {
    document.body.style.overflow = "hidden";
  }
  scrollLockCount++;
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = "";
  }
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 표준 헤더 제목 — 없으면 헤더를 렌더하지 않음 */
  title?: ReactNode;
  size?: ModalSize;
  tone?: ModalTone;
  /** 백드롭 클릭으로 닫기 (기본 true) */
  closeOnBackdrop?: boolean;
  /** ESC로 닫기 (기본 true) */
  closeOnEsc?: boolean;
  /** 열릴 때 포커스할 요소 — 없으면 첫 focusable */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 표준 푸터(우측 정렬 버튼 영역) — 없으면 렌더하지 않음 */
  footer?: ReactNode;
  /** 헤더 우측 닫기(X) 버튼 표시 — title이 있을 때만 유효 */
  showCloseButton?: boolean;
  /** false면 기본 패널 스킨(bg/border/rounded)을 생략 — 자체 스타일 모달용 */
  skin?: boolean;
  /** 패널에 추가할 클래스 */
  panelClassName?: string;
  children: ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  size = "md",
  tone = "default",
  closeOnBackdrop = true,
  closeOnEsc = true,
  initialFocusRef,
  footer,
  showCloseButton = false,
  skin = true,
  panelClassName = "",
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) {
    idRef.current = Symbol("modal");
  }
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeOnEscRef = useRef(closeOnEsc);
  closeOnEscRef.current = closeOnEsc;
  const initialFocusRefRef = useRef(initialFocusRef);
  initialFocusRefRef.current = initialFocusRef;

  useEffect(() => {
    if (!isOpen) return;

    const id = idRef.current!;
    const previousActive = document.activeElement as HTMLElement | null;

    pushModal(id);
    lockScroll();

    // 초기 포커스: initialFocusRef → 첫 focusable → 패널 자체
    const focusTimer = window.setTimeout(() => {
      const target =
        initialFocusRefRef.current?.current ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        panelRef.current;
      target?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopModal(id)) return;

      if (e.key === "Escape" && closeOnEscRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      // focus trap: Tab 순환을 패널 내부로 제한
      if (e.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !panelRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      removeModal(id);
      unlockScroll();
      previousActive?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const skinClasses = skin
    ? "bg-gray-800 rounded-lg shadow-xl border border-gray-700"
    : "";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative w-full ${SIZE_CLASSES[size]} mx-4 outline-none ${skinClasses} ${panelClassName}`}
      >
        {title != null && (
          <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
            <h3
              className={`text-lg font-semibold ${
                tone === "danger" ? "text-red-400" : "text-white"
              }`}
            >
              {title}
            </h3>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition"
                aria-label="Close"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {children}

        {footer != null && (
          <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
