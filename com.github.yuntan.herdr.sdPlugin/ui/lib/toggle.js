/**
 * sdpi-select の値に応じて行の表示 / 非表示を切り替える。
 *
 * sdpi-components には条件表示の仕組みが無いため、ここで最小限を補う。
 * 保存済みの設定は非同期に流し込まれるので、change イベントに加えて
 * 読み込み直後の数回も適用する。
 */
function bindToggle(sourceId, rules) {
  const source = document.getElementById(sourceId);
  if (source === null) {
    return;
  }

  const apply = () => {
    const value = source.value ?? "";
    for (const [targetId, allowed] of Object.entries(rules)) {
      const row = document.getElementById(targetId);
      if (row !== null) {
        row.hidden = !allowed.includes(value);
      }
    }
  };

  source.addEventListener("change", apply);
  for (const delay of [0, 100, 300, 800]) {
    setTimeout(apply, delay);
  }
}
