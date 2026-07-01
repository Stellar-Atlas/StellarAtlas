import { select, selectAll } from "d3-selection";

export function startPropagationAnimation(key: string): void {
  const circles = selectAll(`.propagation-circle[id^='propagation:${key}:']`);
  circles.each(function () {
    const circle = select(this);
    const element = this as SVGCircleElement;
    const motionAnimation = getSvgAnimationElement(
      element.querySelector("animateMotion"),
    );
    const radiusAnimation = getSvgAnimationElement(
      element.querySelector("#radiusAnimation"),
    );
    if (motionAnimation) {
      circle.style("visibility", "visible");
      motionAnimation.beginElement();

      motionAnimation.addEventListener("endEvent", function () {
        if (radiusAnimation) {
          radiusAnimation.beginElement();
          radiusAnimation.addEventListener("endEvent", function () {
            circle.style("visibility", "hidden");
          });
        }
      });
    }
  });
}

type SvgAnimationElement = SVGElement & {
  beginElement: () => void;
};

function getSvgAnimationElement(
  element: Element | null,
): SvgAnimationElement | null {
  if (!element || !("beginElement" in element)) return null;
  return element as SvgAnimationElement;
}
