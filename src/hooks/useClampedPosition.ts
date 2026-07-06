import { RefObject, useEffect, useState } from "react";

/**
 * 컨텍스트 메뉴 등 (x, y)에 띄우는 플로팅 요소가 뷰포트 밖으로
 * 잘리지 않도록 클램핑한 위치를 돌려준다.
 *
 * 요소가 렌더된 뒤 실측 크기로 보정하므로, ref는 위치를 적용할
 * 요소에 연결해야 한다.
 */
export function useClampedPosition(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  margin = 10,
) {
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    let newX = x;
    let newY = y;

    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      if (x + rect.width > window.innerWidth) {
        newX = window.innerWidth - rect.width - margin;
      }
      if (y + rect.height > window.innerHeight) {
        newY = window.innerHeight - rect.height - margin;
      }
    }

    setPosition((prev) =>
      prev.x === newX && prev.y === newY ? prev : { x: newX, y: newY },
    );
    // ref는 안정적인 RefObject라 deps에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, margin]);

  return position;
}
