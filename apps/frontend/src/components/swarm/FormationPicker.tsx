import { useEffect, useRef, useState, useMemo } from "react";
import clsx from "clsx";

export type FormationName =
  | "triangle" | "arrowhead" | "v_wedge" | "diamond"
  | "grid" | "circle" | "line_abreast" | "echelon_left"
  | "echelon_right" | "column" | "staggered_column"
  | "orbit" | "wall"
  // Advanced geometric
  | "fibonacci_spiral" | "spherical_shell" | "double_helix" | "torus"
  | "mobius" | "geodesic_dome" | "lissajous" | "fractal_branch"
  // Military
  | "layered_wedge" | "phalanx" | "funnel" | "offset_dual_grid"
  // Cinematic
  | "radial_crown" | "vertical_wave" | "starburst" | "dna_ladder"
  // Surveillance
  | "concentric_rings" | "sector_fan" | "checkerboard"
  // 3D solids
  | "cube_3d" | "tetrahedron" | "octahedron" | "icosahedron" | "dodecahedron" | "diamond_lattice"
  // Next-level
  | "mirrored_split" | "parametric_surface";

interface FormationEntry { id: FormationName; label: string; icon: string; group: string }

const FORMATIONS: FormationEntry[] = [
  // Classic
  { id: "triangle", label: "Triangle", icon: "△", group: "Classic" },
  { id: "arrowhead", label: "Arrow", icon: "▶", group: "Classic" },
  { id: "v_wedge", label: "V-Wedge", icon: "∨", group: "Classic" },
  { id: "diamond", label: "Diamond", icon: "◇", group: "Classic" },
  { id: "grid", label: "Grid", icon: "⊞", group: "Classic" },
  { id: "circle", label: "Circle", icon: "○", group: "Classic" },
  { id: "line_abreast", label: "Line", icon: "═", group: "Classic" },
  { id: "echelon_left", label: "Ech-L", icon: "╲", group: "Classic" },
  { id: "echelon_right", label: "Ech-R", icon: "╱", group: "Classic" },
  { id: "column", label: "Column", icon: "║", group: "Classic" },
  { id: "staggered_column", label: "Stagger", icon: "⋮", group: "Classic" },
  { id: "orbit", label: "Orbit", icon: "◎", group: "Classic" },
  { id: "wall", label: "Wall", icon: "▬", group: "Classic" },
  // Geometric
  { id: "fibonacci_spiral", label: "Fibonacci", icon: "🌀", group: "Geometric" },
  { id: "spherical_shell", label: "Sphere", icon: "🔮", group: "Geometric" },
  { id: "double_helix", label: "Helix", icon: "🧬", group: "Geometric" },
  { id: "torus", label: "Torus", icon: "🍩", group: "Geometric" },
  { id: "mobius", label: "Möbius", icon: "∞", group: "Geometric" },
  { id: "geodesic_dome", label: "Geodesic", icon: "⬡", group: "Geometric" },
  { id: "lissajous", label: "Lissajous", icon: "∿", group: "Geometric" },
  { id: "fractal_branch", label: "Fractal", icon: "🌿", group: "Geometric" },
  // Military
  { id: "layered_wedge", label: "Layered V", icon: "⋀", group: "Military" },
  { id: "phalanx", label: "Phalanx", icon: "▣", group: "Military" },
  { id: "funnel", label: "Funnel", icon: "⋁", group: "Military" },
  { id: "offset_dual_grid", label: "Dual Grid", icon: "⊡", group: "Military" },
  // Cinematic
  { id: "radial_crown", label: "Crown", icon: "👑", group: "Cinematic" },
  { id: "vertical_wave", label: "Wave", icon: "〰", group: "Cinematic" },
  { id: "starburst", label: "Starburst", icon: "✳", group: "Cinematic" },
  { id: "dna_ladder", label: "DNA", icon: "⌬", group: "Cinematic" },
  // Surveillance
  { id: "concentric_rings", label: "Rings", icon: "◉", group: "Surveillance" },
  { id: "sector_fan", label: "Fan", icon: "◔", group: "Surveillance" },
  { id: "checkerboard", label: "Checker", icon: "▦", group: "Surveillance" },
  // 3D Solids
  { id: "tetrahedron", label: "Tetra", icon: "△", group: "3D Solids" },
  { id: "cube_3d", label: "Cube", icon: "⬜", group: "3D Solids" },
  { id: "octahedron", label: "Octa", icon: "◈", group: "3D Solids" },
  { id: "icosahedron", label: "Icosa", icon: "⬠", group: "3D Solids" },
  { id: "dodecahedron", label: "Dodeca", icon: "⬡", group: "3D Solids" },
  { id: "diamond_lattice", label: "Lattice", icon: "❖", group: "3D Solids" },
  // Next-level
  { id: "mirrored_split", label: "Mirror", icon: "⫼", group: "Advanced" },
  { id: "parametric_surface", label: "Surface", icon: "≋", group: "Advanced" },
];

/**
 * Lightweight client-side formation offset computation for canvas preview.
 * Returns normalized {x, y}[] relative to leader at (0,0).
 */
function computeFormationOffsets(
  formation: FormationName,
  count: number,
  spacing: number
): Array<{ x: number; y: number }> {
  const offsets: Array<{ x: number; y: number }> = [];

  switch (formation) {
    case "triangle": {
      let placed = 0;
      let row = 1;
      while (placed < count) {
        const inRow = row + 1;
        for (let col = 0; col < inRow && placed < count; col++) {
          offsets.push({ x: (col - (inRow - 1) / 2) * spacing, y: row * spacing });
          placed++;
        }
        row++;
      }
      break;
    }
    case "arrowhead": {
      for (let i = 0; i < count; i++) {
        const rank = Math.floor(i / 2) + 1;
        const side = i % 2 === 0 ? -1 : 1;
        offsets.push({ x: side * rank * spacing * 0.6, y: rank * spacing * 0.8 });
      }
      break;
    }
    case "v_wedge": {
      for (let i = 0; i < count; i++) {
        const rank = Math.floor(i / 2) + 1;
        const side = i % 2 === 0 ? -1 : 1;
        offsets.push({ x: side * rank * spacing, y: rank * spacing });
      }
      break;
    }
    case "diamond": {
      const pts: Array<{ x: number; y: number }> = [
        { x: -spacing, y: 0 }, { x: spacing, y: 0 },
        { x: 0, y: spacing }, { x: 0, y: -spacing }
      ];
      let ring = 2;
      while (pts.length < count) {
        const r = ring * spacing;
        for (const [ex, ey] of [[0, -r], [0, r], [-r, 0], [r, 0]]) {
          if (pts.length >= count) break;
          pts.push({ x: ex, y: ey });
        }
        ring++;
      }
      for (let i = 0; i < count; i++) offsets.push(pts[i]);
      break;
    }
    case "grid": {
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        offsets.push({ x: (col - (cols - 1) / 2) * spacing, y: row * spacing });
      }
      break;
    }
    case "circle":
    case "orbit": {
      const radius = Math.max(spacing, (count * spacing) / (2 * Math.PI));
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        offsets.push({ x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius });
      }
      break;
    }
    case "line_abreast": {
      for (let i = 0; i < count; i++) {
        const pos = i + 1;
        const side = pos % 2 === 1 ? -1 : 1;
        const rank = Math.ceil(pos / 2);
        offsets.push({ x: side * rank * spacing, y: 0 });
      }
      break;
    }
    case "echelon_left": {
      for (let i = 0; i < count; i++) {
        const rank = i + 1;
        offsets.push({ x: -rank * spacing * 0.707, y: rank * spacing * 0.707 });
      }
      break;
    }
    case "echelon_right": {
      for (let i = 0; i < count; i++) {
        const rank = i + 1;
        offsets.push({ x: rank * spacing * 0.707, y: rank * spacing * 0.707 });
      }
      break;
    }
    case "column": {
      for (let i = 0; i < count; i++) {
        offsets.push({ x: 0, y: (i + 1) * spacing });
      }
      break;
    }
    case "staggered_column": {
      for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        offsets.push({ x: side * spacing * 0.4, y: (i + 1) * spacing });
      }
      break;
    }
    case "wall": {
      const wallCols = Math.ceil(Math.sqrt(count * 2));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / wallCols);
        const col = i % wallCols;
        offsets.push({ x: (col - (wallCols - 1) / 2) * spacing, y: row * spacing });
      }
      break;
    }

    // ── Advanced Geometric ──
    case "fibonacci_spiral": {
      const golden = (1 + Math.sqrt(5)) / 2;
      const goldenAngle = 2 * Math.PI * (1 - 1 / golden);
      for (let i = 0; i < count; i++) {
        const r = spacing * Math.sqrt(i + 1);
        const theta = (i + 1) * goldenAngle;
        offsets.push({ x: Math.sin(theta) * r, y: -Math.cos(theta) * r });
      }
      break;
    }
    case "spherical_shell": {
      const phi = (1 + Math.sqrt(5)) / 2;
      const radius = Math.max(spacing, (count * spacing) / (4 * Math.PI));
      for (let i = 0; i < count; i++) {
        const yNorm = 1 - (2 * (i + 0.5)) / count;
        const rSlice = Math.sqrt(1 - yNorm * yNorm);
        const theta = 2 * Math.PI * (i + 1) / phi;
        offsets.push({ x: Math.sin(theta) * rSlice * radius, y: -Math.cos(theta) * rSlice * radius });
      }
      break;
    }
    case "double_helix": {
      const hr = spacing;
      for (let i = 0; i < count; i++) {
        const strand = i % 2;
        const pos = Math.floor(i / 2);
        const theta = (pos * Math.PI) / 3;
        const phase = strand * Math.PI;
        offsets.push({ x: Math.sin(theta + phase) * hr, y: pos * spacing * 0.3 });
      }
      break;
    }
    case "torus": {
      const majR = Math.max(spacing * 2, (count * spacing) / (2 * Math.PI));
      const minR = spacing;
      const nMaj = Math.ceil(Math.sqrt(count * 2));
      for (let i = 0; i < count; i++) {
        const majIdx = i % nMaj;
        const minIdx = Math.floor(i / nMaj);
        const nMin = Math.ceil(count / nMaj);
        const tM = (2 * Math.PI * majIdx) / nMaj;
        const tN = (2 * Math.PI * minIdx) / nMin;
        const r = majR + minR * Math.cos(tN);
        offsets.push({ x: r * Math.sin(tM), y: -r * Math.cos(tM) });
      }
      break;
    }
    case "mobius": {
      const mR = Math.max(spacing * 2, (count * spacing) / (2 * Math.PI));
      const mW = spacing;
      for (let i = 0; i < count; i++) {
        const t = (2 * Math.PI * i) / count;
        const halfTwist = t / 2;
        const side = (i % 2 === 0 ? 1 : -1) * mW * 0.5;
        offsets.push({
          x: (mR + side * Math.cos(halfTwist)) * Math.sin(t),
          y: -(mR + side * Math.cos(halfTwist)) * Math.cos(t)
        });
      }
      break;
    }
    case "geodesic_dome": {
      const gR = Math.max(spacing, (count * spacing) / Math.PI);
      const gPhi = (1 + Math.sqrt(5)) / 2;
      for (let i = 0; i < count; i++) {
        const yNorm = 1 - (i + 0.5) / count;
        const rSlice = Math.sqrt(1 - yNorm * yNorm);
        const theta = 2 * Math.PI * (i + 1) / gPhi;
        offsets.push({ x: Math.sin(theta) * rSlice * gR, y: -Math.cos(theta) * rSlice * gR });
      }
      break;
    }
    case "lissajous": {
      const lAmp = spacing * Math.max(2, Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const t = (2 * Math.PI * i) / count;
        offsets.push({ x: Math.sin(2 * t + Math.PI / 4) * lAmp, y: -Math.sin(3 * t) * lAmp });
      }
      break;
    }
    case "fractal_branch": {
      const brAngle = Math.PI / 5;
      const brLen = spacing;
      const queue: Array<{ x: number; y: number; angle: number; depth: number }> = [
        { x: -brLen * 0.3, y: brLen, angle: -brAngle, depth: 1 },
        { x: brLen * 0.3, y: brLen, angle: brAngle, depth: 1 }
      ];
      let qi = 0;
      while (offsets.length < count && qi < queue.length) {
        const n = queue[qi++];
        offsets.push({ x: n.x, y: n.y });
        if (offsets.length >= count) break;
        const len = brLen * Math.pow(0.7, n.depth);
        queue.push(
          { x: n.x + Math.sin(n.angle - brAngle) * len, y: n.y + Math.cos(n.angle - brAngle) * len, angle: n.angle - brAngle, depth: n.depth + 1 },
          { x: n.x + Math.sin(n.angle + brAngle) * len, y: n.y + Math.cos(n.angle + brAngle) * len, angle: n.angle + brAngle, depth: n.depth + 1 }
        );
      }
      while (offsets.length < count) offsets.push({ x: 0, y: (offsets.length + 1) * spacing * 0.5 });
      break;
    }

    // ── Military ──
    case "layered_wedge": {
      const tiers = Math.max(2, Math.ceil(count / 6));
      let placed = 0;
      for (let tier = 0; tier < tiers && placed < count; tier++) {
        const tc = Math.ceil((count - placed) / (tiers - tier));
        for (let i = 0; i < tc && placed < count; i++) {
          const rank = Math.floor(i / 2) + 1;
          const side = i % 2 === 0 ? -1 : 1;
          // Show tier offset visually as slight horizontal shift
          offsets.push({ x: side * rank * spacing + tier * 3, y: rank * spacing + tier * 2 });
          placed++;
        }
      }
      break;
    }
    case "phalanx": {
      const pCols = Math.ceil(Math.sqrt(count * 1.5));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / pCols);
        const col = i % pCols;
        offsets.push({ x: (col - (pCols - 1) / 2) * spacing, y: (row + 1) * spacing * 0.8 });
      }
      break;
    }
    case "funnel": {
      for (let i = 0; i < count; i++) {
        const rank = Math.floor(i / 2) + 1;
        const side = i % 2 === 0 ? -1 : 1;
        const widthFactor = Math.max(0.2, 1 - rank / (count + 1));
        offsets.push({ x: side * rank * spacing * widthFactor, y: rank * spacing });
      }
      break;
    }
    case "offset_dual_grid": {
      const dCols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const layer = i < Math.ceil(count / 2) ? 0 : 1;
        const li = layer === 0 ? i : i - Math.ceil(count / 2);
        const row = Math.floor(li / dCols);
        const col = li % dCols;
        const off = layer * spacing * 0.5;
        offsets.push({ x: (col - (dCols - 1) / 2) * spacing + off, y: row * spacing + off });
      }
      break;
    }

    // ── Cinematic ──
    case "radial_crown": {
      const cR = spacing * 1.5;
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        offsets.push({ x: Math.sin(angle) * cR, y: -Math.cos(angle) * cR });
      }
      break;
    }
    case "vertical_wave": {
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * spacing;
        const waveY = Math.sin((i / count) * 2 * Math.PI) * spacing * 1.5;
        offsets.push({ x, y: waveY });
      }
      break;
    }
    case "starburst": {
      const arms = Math.max(3, Math.ceil(count / 3));
      for (let i = 0; i < count; i++) {
        const arm = i % arms;
        const armRank = Math.floor(i / arms) + 1;
        const angle = (2 * Math.PI * arm) / arms;
        offsets.push({ x: Math.sin(angle) * armRank * spacing, y: -Math.cos(angle) * armRank * spacing });
      }
      break;
    }
    case "dna_ladder": {
      for (let i = 0; i < count; i++) {
        const rung = Math.floor(i / 2);
        const strand = i % 2;
        const twist = (rung * Math.PI) / 4;
        const sideOff = strand === 0 ? -spacing * 0.5 : spacing * 0.5;
        offsets.push({ x: Math.sin(twist) * sideOff, y: rung * spacing * 0.6 });
      }
      break;
    }

    // ── Surveillance ──
    case "concentric_rings": {
      const nRings = Math.max(2, Math.ceil(Math.sqrt(count / 3)));
      let placed = 0;
      for (let ring = 1; ring <= nRings && placed < count; ring++) {
        const r = ring * spacing;
        const ringCount = Math.min(Math.ceil((count - placed) / (nRings - ring + 1)), Math.floor(2 * Math.PI * r / spacing));
        for (let j = 0; j < ringCount && placed < count; j++) {
          const angle = (2 * Math.PI * j) / ringCount;
          offsets.push({ x: Math.sin(angle) * r, y: -Math.cos(angle) * r });
          placed++;
        }
      }
      break;
    }
    case "sector_fan": {
      const fanAngle = (120 * Math.PI) / 180;
      const fanRings = Math.max(2, Math.ceil(Math.sqrt(count)));
      let placed = 0;
      for (let ring = 1; ring <= fanRings && placed < count; ring++) {
        const r = ring * spacing;
        const arcCount = Math.ceil(count / fanRings);
        for (let j = 0; j < arcCount && placed < count; j++) {
          const angle = -fanAngle / 2 + (fanAngle * j) / Math.max(1, arcCount - 1);
          offsets.push({ x: Math.sin(angle) * r, y: -Math.cos(angle) * r });
          placed++;
        }
      }
      break;
    }
    case "checkerboard": {
      const cbCols = Math.ceil(Math.sqrt(count * 2));
      let placed = 0;
      let row = 0;
      while (placed < count) {
        for (let col = 0; col < cbCols && placed < count; col++) {
          if ((row + col) % 2 !== 0) continue;
          offsets.push({ x: (col - (cbCols - 1) / 2) * spacing, y: row * spacing });
          placed++;
        }
        row++;
      }
      break;
    }

    // ── 3D Solids (projected to 2D for preview) ──
    case "tetrahedron": {
      const tS = spacing * 1.5;
      const verts2d = [
        { x: 0, y: -tS }, { x: tS * 0.866, y: tS * 0.5 },
        { x: -tS * 0.866, y: tS * 0.5 }, { x: 0, y: 0 }
      ];
      for (let i = 0; i < count; i++) {
        if (i < verts2d.length) offsets.push(verts2d[i]);
        else {
          const eIdx = (i - 4) % 6;
          const edges = [[0,1],[1,2],[2,0],[0,3],[1,3],[2,3]];
          const [a, b] = edges[eIdx];
          const t = ((Math.floor((i - 4) / 6) + 1)) / (Math.ceil((count - 4) / 6) + 1);
          offsets.push({ x: verts2d[a].x + (verts2d[b].x - verts2d[a].x) * t, y: verts2d[a].y + (verts2d[b].y - verts2d[a].y) * t });
        }
      }
      break;
    }
    case "cube_3d": {
      const cS = spacing;
      // Isometric projection of cube
      const cubeV = [
        { x: -cS, y: -cS }, { x: cS, y: -cS }, { x: cS, y: cS }, { x: -cS, y: cS },
        { x: -cS * 0.5, y: -cS * 1.5 }, { x: cS * 1.5, y: -cS * 0.5 },
        { x: cS * 0.5, y: cS * 1.5 }, { x: -cS * 1.5, y: cS * 0.5 }
      ];
      for (let i = 0; i < count; i++) {
        if (i < cubeV.length) offsets.push(cubeV[i]);
        else {
          const edgeList: [number, number][] = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
          const eIdx = (i - 8) % edgeList.length;
          const t = ((Math.floor((i - 8) / 12) + 1)) / (Math.ceil((count - 8) / 12) + 1);
          const [a, b] = edgeList[eIdx];
          offsets.push({ x: cubeV[a].x + (cubeV[b].x - cubeV[a].x) * t, y: cubeV[a].y + (cubeV[b].y - cubeV[a].y) * t });
        }
      }
      break;
    }
    case "octahedron": {
      const oS = spacing * 1.5;
      const octV = [
        { x: oS, y: 0 }, { x: -oS, y: 0 }, { x: 0, y: oS },
        { x: 0, y: -oS }, { x: oS * 0.5, y: oS * 0.5 }, { x: -oS * 0.5, y: -oS * 0.5 }
      ];
      for (let i = 0; i < count; i++) {
        if (i < octV.length) offsets.push(octV[i]);
        else {
          const vi = i % octV.length;
          const ni = (vi + 1) % octV.length;
          const t = (Math.floor(i / octV.length)) / (Math.ceil(count / octV.length));
          offsets.push({ x: octV[vi].x + (octV[ni].x - octV[vi].x) * t * 0.5, y: octV[vi].y + (octV[ni].y - octV[vi].y) * t * 0.5 });
        }
      }
      break;
    }
    case "icosahedron": {
      const iS = spacing * 1.5;
      // Approximate 2D projection of icosahedron: two pentagons + poles
      const icoV: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 5; i++) { const a = (2 * Math.PI * i) / 5 - Math.PI / 2; icoV.push({ x: Math.cos(a) * iS, y: Math.sin(a) * iS }); }
      for (let i = 0; i < 5; i++) { const a = (2 * Math.PI * i) / 5 - Math.PI / 2 + Math.PI / 5; icoV.push({ x: Math.cos(a) * iS * 0.6, y: Math.sin(a) * iS * 0.6 }); }
      icoV.push({ x: 0, y: -iS * 1.3 }, { x: 0, y: iS * 1.3 });
      for (let i = 0; i < count; i++) {
        if (i < icoV.length) offsets.push(icoV[i]);
        else { const vi = i % icoV.length; offsets.push({ x: icoV[vi].x * 0.85, y: icoV[vi].y * 0.85 }); }
      }
      break;
    }
    case "dodecahedron": {
      const dS = spacing;
      // 2D projection: two concentric pentagons + vertex ring
      const dodV: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 5; i++) { const a = (2 * Math.PI * i) / 5 - Math.PI / 2; dodV.push({ x: Math.cos(a) * dS * 1.8, y: Math.sin(a) * dS * 1.8 }); }
      for (let i = 0; i < 5; i++) { const a = (2 * Math.PI * i) / 5 - Math.PI / 2 + Math.PI / 5; dodV.push({ x: Math.cos(a) * dS * 1.2, y: Math.sin(a) * dS * 1.2 }); }
      for (let i = 0; i < 5; i++) { const a = (2 * Math.PI * i) / 5 - Math.PI / 2; dodV.push({ x: Math.cos(a) * dS * 0.7, y: Math.sin(a) * dS * 0.7 }); }
      for (let i = 0; i < 5; i++) { const a = (2 * Math.PI * i) / 5 - Math.PI / 2 + Math.PI / 5; dodV.push({ x: Math.cos(a) * dS * 0.3, y: Math.sin(a) * dS * 0.3 }); }
      for (let i = 0; i < count; i++) {
        if (i < dodV.length) offsets.push(dodV[i]);
        else { const vi = i % dodV.length; offsets.push({ x: dodV[vi].x * 1.1, y: dodV[vi].y * 1.1 }); }
      }
      break;
    }
    case "diamond_lattice": {
      const dlCols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / dlCols);
        const col = i % dlCols;
        const fccOff = (row % 2 === 0) ? 0 : spacing * 0.5;
        offsets.push({ x: (col - (dlCols - 1) / 2) * spacing + fccOff, y: row * spacing * 0.707 });
      }
      break;
    }

    // ── Next-level ──
    case "mirrored_split": {
      const half = Math.ceil(count / 2);
      const gap = spacing * 1.5;
      for (let i = 0; i < count; i++) {
        const h = i < half ? 0 : 1;
        const hi = h === 0 ? i : i - half;
        const side = h === 0 ? -1 : 1;
        offsets.push({ x: side * gap + side * (hi % 3) * spacing * 0.5, y: (hi + 1) * spacing * 0.7 });
      }
      break;
    }
    case "parametric_surface": {
      const psCols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / psCols);
        const col = i % psCols;
        offsets.push({ x: (col - (psCols - 1) / 2) * spacing, y: (row - (psCols - 1) / 2) * spacing });
      }
      break;
    }

    default:
      for (let i = 0; i < count; i++) offsets.push({ x: 0, y: (i + 1) * spacing });
  }

  return offsets;
}

function FormationPreview({
  formation,
  droneCount,
  spacing
}: {
  formation: FormationName;
  droneCount: number;
  spacing: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 140;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, size, size);

    // Background grid lines
    ctx.strokeStyle = "rgba(61, 224, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }

    const effectiveCount = Math.max(1, droneCount);
    const offsets = computeFormationOffsets(formation, effectiveCount, spacing);

    // Find bounds to scale
    const allX = [0, ...offsets.map((o) => o.x)];
    const allY = [0, ...offsets.map((o) => o.y)];
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scale = Math.min((size - 32) / rangeX, (size - 32) / rangeY);
    const cx = size / 2;
    const cy = size / 2;
    const offsetCx = (minX + maxX) / 2;
    const offsetCy = (minY + maxY) / 2;

    const toScreen = (x: number, y: number) => ({
      sx: cx + (x - offsetCx) * scale,
      sy: cy + (y - offsetCy) * scale
    });

    // Draw connection lines from leader to followers
    ctx.strokeStyle = "rgba(61, 224, 255, 0.12)";
    ctx.lineWidth = 1;
    const { sx: lx, sy: ly } = toScreen(0, 0);
    for (const offset of offsets) {
      const { sx, sy } = toScreen(offset.x, offset.y);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }

    // Draw followers with glow
    for (const offset of offsets) {
      const { sx, sy } = toScreen(offset.x, offset.y);
      // Glow
      ctx.beginPath();
      ctx.arc(sx, sy, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(61, 224, 255, 0.12)";
      ctx.fill();
      // Dot
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(61, 224, 255, 0.7)";
      ctx.fill();
    }

    // Draw leader with glow
    // Glow ring
    ctx.beginPath();
    ctx.arc(lx, ly, 10, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(245, 177, 74, 0.15)";
    ctx.fill();
    // Leader dot
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#f5b14a";
    ctx.fill();
    // Leader ring
    ctx.beginPath();
    ctx.arc(lx, ly, 7, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245, 177, 74, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [formation, droneCount, spacing]);

  return <canvas ref={canvasRef} className="h-[140px] w-[140px]" />;
}

interface FormationPickerProps {
  value: FormationName;
  onChange: (formation: FormationName) => void;
  droneCount: number;
  spacing: number;
}

const FORMATION_GROUPS = ["All", "Classic", "Geometric", "Military", "Cinematic", "Surveillance", "3D Solids", "Advanced"] as const;

export function FormationPicker({ value, onChange, droneCount, spacing }: FormationPickerProps): JSX.Element {
  const [activeGroup, setActiveGroup] = useState<string>("All");

  const filtered = useMemo(() => {
    if (activeGroup === "All") return FORMATIONS;
    return FORMATIONS.filter((f) => f.group === activeGroup);
  }, [activeGroup]);

  return (
    <div className="space-y-2">
      {/* Group filter pills */}
      <div className="flex flex-wrap gap-1">
        {FORMATION_GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => setActiveGroup(g)}
            className={clsx(
              "rounded px-2 py-0.5 font-[Orbitron] text-[8px] uppercase tracking-wider transition",
              activeGroup === g
                ? "bg-accent-cyan/20 text-accent-cyan"
                : "bg-bg-900/40 text-cyan-100/40 hover:bg-bg-900/60 hover:text-cyan-100/60"
            )}
          >
            {g}
          </button>
        ))}
      </div>
      {/* Formation grid */}
      <div className="grid grid-cols-5 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
        {filtered.map((f) => (
          <button
            key={f.id}
            onClick={() => onChange(f.id)}
            className={clsx(
              "flex flex-col items-center justify-center gap-0.5 rounded border px-1 py-1.5 text-center transition",
              value === f.id
                ? "border-accent-cyan/50 bg-accent-cyan/10 shadow-[0_0_8px_rgba(61,224,255,0.15)]"
                : "border-cyan-300/15 bg-bg-900/40 hover:border-cyan-300/30 hover:bg-bg-900/60"
            )}
          >
            <span className={clsx("text-base leading-none", value === f.id ? "text-accent-cyan" : "text-cyan-100/40")}>
              {f.icon}
            </span>
            <span className={clsx(
              "font-[Orbitron] text-[7px] uppercase tracking-wider leading-tight",
              value === f.id ? "text-accent-cyan" : "text-cyan-100/50"
            )}>
              {f.label}
            </span>
          </button>
        ))}
      </div>
      {/* Preview */}
      <div className="flex justify-center rounded border border-cyan-300/10 bg-[rgba(4,15,28,0.75)] p-3">
        <FormationPreview formation={value} droneCount={droneCount} spacing={spacing} />
      </div>
    </div>
  );
}

export { FORMATIONS, computeFormationOffsets };
