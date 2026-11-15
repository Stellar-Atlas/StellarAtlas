import { escapeEventText } from "../escape-event-text";

test("renders hostile imported statement and node labels as literal text", () => {
  const hostile = '</span><img src=x onerror="alert(1)"> & \'node\' &lt;b&gt;';
  const escaped =
    "&lt;/span&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;node&#39; &amp;lt;b&amp;gt;";

  expect(escapeEventText(hostile)).toBe(escaped);
  expect(escapeEventText([hostile, "Alice"].join(", "))).toBe(
    `${escaped}, Alice`,
  );
  expect(escapeEventText("pizza, Alice, Bob")).toBe("pizza, Alice, Bob");
});
