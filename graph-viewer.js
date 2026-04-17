/* global vis */
(function () {
  const GROUP_PALETTE = [
    { bg: "#7c3aed", border: "#5b21b6" },
    { bg: "#0ea5e9", border: "#075985" },
    { bg: "#10b981", border: "#065f46" },
    { bg: "#f59e0b", border: "#b45309" },
    { bg: "#ec4899", border: "#9d174d" },
    { bg: "#14b8a6", border: "#115e59" },
    { bg: "#f97316", border: "#9a3412" },
    { bg: "#a855f7", border: "#6b21a8" },
    { bg: "#22d3ee", border: "#155e75" },
    { bg: "#4ade80", border: "#166534" },
  ];

  function hashGroup(s) {
    let h = 0;
    const str = String(s || "default");
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function colorForGroup(group) {
    return GROUP_PALETTE[hashGroup(group) % GROUP_PALETTE.length];
  }

  function wrapLabel(text, maxLen) {
    const t = String(text || "");
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen - 1) + "…";
  }

  async function main() {
    const data = await chrome.storage.session.get(["interactiveGraph", "graphPageTitle", "graphPageUrl"]);

    const titleEl = document.getElementById("title");
    const subEl = document.getElementById("subtitle");
    const container = document.getElementById("network");

    if (!data.interactiveGraph) {
      titleEl.textContent = "No graph data";
      subEl.textContent = "Close this tab and run “Interactive graph” again from the extension popup.";
      return;
    }

    let graph;
    try {
      graph =
        typeof data.interactiveGraph === "string"
          ? JSON.parse(data.interactiveGraph)
          : data.interactiveGraph;
    } catch {
      titleEl.textContent = "Invalid graph data";
      return;
    }

    const nodesArr = graph.nodes || [];
    const edgesArr = graph.edges || [];
    if (!nodesArr.length) {
      titleEl.textContent = "Empty graph";
      return;
    }

    titleEl.textContent = graph.title || data.graphPageTitle || "Concept graph";
    subEl.textContent = data.graphPageUrl || "";

    const visNodes = nodesArr.map((n) => {
      const c = colorForGroup(n.group);
      const full = n.label + (n.group ? `\n— ${n.group}` : "");
      return {
        id: n.id,
        label: wrapLabel(n.label, 40),
        title: full,
        color: {
          background: c.bg,
          border: c.border,
          highlight: { background: "#818cf8", border: "#f8fafc" },
          hover: { background: "#a78bfa", border: "#f8fafc" },
        },
        font: { color: "#ffffff", size: 15, face: "system-ui, Segoe UI, sans-serif" },
        shape: "dot",
        size: 28,
        borderWidth: 3,
      };
    });

    const visEdges = edgesArr.map((e, i) => ({
      id: `e${i}`,
      from: e.from,
      to: e.to,
      label: e.label ? wrapLabel(e.label, 44) : "",
      title: e.label || "",
      arrows: { to: { enabled: true, scaleFactor: 0.85 } },
      color: {
        color: "rgba(148, 163, 184, 0.9)",
        highlight: "#a78bfa",
        hover: "#c4b5fd",
      },
      font: { color: "#e2e8f0", size: 12, strokeWidth: 0, align: "middle" },
      smooth: { type: "continuous", roundness: 0.4 },
      width: 2,
    }));

    const dsNodes = new vis.DataSet(visNodes);
    const dsEdges = new vis.DataSet(visEdges);
    const netData = { nodes: dsNodes, edges: dsEdges };

    const options = {
      autoResize: true,
      nodes: {
        scaling: { min: 22, max: 42 },
        margin: 14,
      },
      edges: {
        selectionWidth: 3,
      },
      physics: {
        enabled: true,
        solver: "forceAtlas2Based",
        forceAtlas2Based: {
          gravitationalConstant: -42,
          centralGravity: 0.009,
          springLength: 190,
          springConstant: 0.048,
          avoidOverlap: 0.92,
        },
        stabilization: { iterations: 240, updateInterval: 20 },
      },
      interaction: {
        hover: true,
        navigationButtons: true,
        keyboard: true,
        tooltipDelay: 60,
        zoomView: true,
        dragView: true,
      },
    };

    const network = new vis.Network(container, netData, options);

    function fitView() {
      network.resize();
      network.fit({ padding: 56 });
    }

    requestAnimationFrame(() => {
      fitView();
    });

    network.once("stabilizationIterationsDone", () => {
      network.setOptions({ physics: false });
      fitView();
    });

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        network.resize();
        fitView();
      }, 120);
    });
  }

  main();
})();
