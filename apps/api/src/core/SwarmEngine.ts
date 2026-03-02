import { offsetLatLon } from "../simulation/geo";

export type FormationName =
  | "triangle"
  | "arrowhead"
  | "v_wedge"
  | "diamond"
  | "grid"
  | "circle"
  | "line_abreast"
  | "echelon_left"
  | "echelon_right"
  | "column"
  | "staggered_column"
  | "orbit"
  | "wall"
  // Advanced geometric / mathematical
  | "fibonacci_spiral"
  | "spherical_shell"
  | "double_helix"
  | "torus"
  | "mobius"
  | "geodesic_dome"
  | "lissajous"
  | "fractal_branch"
  // Military / tactical expansion
  | "layered_wedge"
  | "phalanx"
  | "funnel"
  | "offset_dual_grid"
  // Cinematic / visual impact
  | "radial_crown"
  | "vertical_wave"
  | "starburst"
  | "dna_ladder"
  // Surveillance / coverage
  | "concentric_rings"
  | "sector_fan"
  | "checkerboard"
  // 3D platonic solids & structures
  | "cube_3d"
  | "tetrahedron"
  | "octahedron"
  | "icosahedron"
  | "dodecahedron"
  | "diamond_lattice"
  // Next-level
  | "mirrored_split"
  | "parametric_surface";

export const ALL_FORMATION_NAMES: FormationName[] = [
  "triangle",
  "arrowhead",
  "v_wedge",
  "diamond",
  "grid",
  "circle",
  "line_abreast",
  "echelon_left",
  "echelon_right",
  "column",
  "staggered_column",
  "orbit",
  "wall",
  "fibonacci_spiral",
  "spherical_shell",
  "double_helix",
  "torus",
  "mobius",
  "geodesic_dome",
  "lissajous",
  "fractal_branch",
  "layered_wedge",
  "phalanx",
  "funnel",
  "offset_dual_grid",
  "radial_crown",
  "vertical_wave",
  "starburst",
  "dna_ladder",
  "concentric_rings",
  "sector_fan",
  "checkerboard",
  "cube_3d",
  "tetrahedron",
  "octahedron",
  "icosahedron",
  "dodecahedron",
  "diamond_lattice",
  "mirrored_split",
  "parametric_surface"
];

export interface FormationParams {
  formation: FormationName;
  spacing: number; // meters between drones (default 15)
  headingDeg: number; // formation rotation in degrees (default 0 = north)
  altOffset: number; // vertical layer spacing in meters (default 0)
  droneCount: number;
}

interface Offset {
  north: number;
  east: number;
  alt: number;
}

const DEG_TO_RAD = Math.PI / 180;

/** Rotate a 2D offset (north/east) by headingDeg clockwise from north. */
function rotateOffset(north: number, east: number, headingDeg: number): { north: number; east: number } {
  if (headingDeg === 0) return { north, east };
  const rad = headingDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    north: north * cos - east * sin,
    east: north * sin + east * cos
  };
}

/**
 * Generate parametric formation offsets for `count` follower drones.
 * Index 0 = first follower (NOT the leader). The leader is always at {0,0,0}.
 */
function generateOffsets(formation: FormationName, count: number, spacing: number, altOffset: number): Offset[] {
  const offsets: Offset[] = [];

  switch (formation) {
    case "triangle": {
      // Leader at apex, rows of increasing width behind
      let placed = 0;
      let row = 1;
      while (placed < count) {
        const dronesInRow = row + 1;
        for (let col = 0; col < dronesInRow && placed < count; col++) {
          const east = (col - (dronesInRow - 1) / 2) * spacing;
          offsets.push({ north: -row * spacing, east, alt: altOffset * row });
          placed++;
        }
        row++;
      }
      break;
    }

    case "arrowhead": {
      // V-shape with drones alternating left/right behind leader
      for (let i = 0; i < count; i++) {
        const rank = Math.floor(i / 2) + 1;
        const side = i % 2 === 0 ? -1 : 1;
        offsets.push({
          north: -rank * spacing * 0.8,
          east: side * rank * spacing * 0.6,
          alt: altOffset * rank
        });
      }
      break;
    }

    case "v_wedge": {
      // Classic V formation, alternating sides
      for (let i = 0; i < count; i++) {
        const rank = Math.floor(i / 2) + 1;
        const side = i % 2 === 0 ? -1 : 1;
        offsets.push({
          north: -rank * spacing,
          east: side * rank * spacing,
          alt: altOffset * rank
        });
      }
      break;
    }

    case "diamond": {
      // Diamond shape: left, right, back, then fill additional positions
      const positions: Offset[] = [
        { north: 0, east: -spacing, alt: 0 },
        { north: 0, east: spacing, alt: 0 },
        { north: -spacing, east: 0, alt: altOffset },
        { north: spacing, east: 0, alt: -altOffset }
      ];
      // For more than 4, expand outward in concentric diamonds
      let ring = 2;
      while (positions.length < count) {
        const r = ring * spacing;
        for (const [n, e] of [[0, -r], [0, r], [-r, 0], [r, 0], [-r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [r * 0.7, r * 0.7]]) {
          if (positions.length >= count) break;
          positions.push({ north: n, east: e, alt: altOffset * ring });
        }
        ring++;
      }
      for (let i = 0; i < count; i++) {
        offsets.push(positions[i]);
      }
      break;
    }

    case "grid": {
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        offsets.push({
          north: -row * spacing,
          east: (col - (cols - 1) / 2) * spacing,
          alt: altOffset * row
        });
      }
      break;
    }

    case "circle":
    case "orbit": {
      // Evenly spaced around circumference, radius scales with count
      const radius = Math.max(spacing, (count * spacing) / (2 * Math.PI));
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        offsets.push({
          north: Math.cos(angle) * radius,
          east: Math.sin(angle) * radius,
          alt: altOffset
        });
      }
      break;
    }

    case "line_abreast": {
      // Single perpendicular line, centered on leader
      for (let i = 0; i < count; i++) {
        const pos = i + 1;
        const side = pos % 2 === 1 ? -1 : 1;
        const rank = Math.ceil(pos / 2);
        offsets.push({
          north: 0,
          east: side * rank * spacing,
          alt: altOffset
        });
      }
      break;
    }

    case "echelon_left": {
      for (let i = 0; i < count; i++) {
        const rank = i + 1;
        offsets.push({
          north: -rank * spacing * 0.707,
          east: -rank * spacing * 0.707,
          alt: altOffset * rank
        });
      }
      break;
    }

    case "echelon_right": {
      for (let i = 0; i < count; i++) {
        const rank = i + 1;
        offsets.push({
          north: -rank * spacing * 0.707,
          east: rank * spacing * 0.707,
          alt: altOffset * rank
        });
      }
      break;
    }

    case "column": {
      // Single file behind leader
      for (let i = 0; i < count; i++) {
        offsets.push({
          north: -(i + 1) * spacing,
          east: 0,
          alt: altOffset * (i + 1)
        });
      }
      break;
    }

    case "staggered_column": {
      // Column with alternating east offsets
      for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        offsets.push({
          north: -(i + 1) * spacing,
          east: side * spacing * 0.4,
          alt: altOffset * (i + 1)
        });
      }
      break;
    }

    case "wall": {
      // Multi-row line_abreast
      const wallCols = Math.ceil(Math.sqrt(count * 2));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / wallCols);
        const col = i % wallCols;
        offsets.push({
          north: -row * spacing,
          east: (col - (wallCols - 1) / 2) * spacing,
          alt: altOffset * row
        });
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════
    // ADVANCED GEOMETRIC / MATHEMATICAL
    // ═══════════════════════════════════════════════════════════

    case "fibonacci_spiral": {
      // Golden-ratio radial distribution — Fermat's spiral / sunflower phyllotaxis
      const golden = (1 + Math.sqrt(5)) / 2;
      const goldenAngle = 2 * Math.PI * (1 - 1 / golden); // ~137.5°
      for (let i = 0; i < count; i++) {
        const r = spacing * Math.sqrt(i + 1);
        const theta = (i + 1) * goldenAngle;
        offsets.push({ north: Math.cos(theta) * r, east: Math.sin(theta) * r, alt: altOffset });
      }
      break;
    }

    case "spherical_shell": {
      // Equal-area distribution on a sphere using Fibonacci lattice on sphere surface
      const phi = (1 + Math.sqrt(5)) / 2;
      const radius = Math.max(spacing, (count * spacing) / (4 * Math.PI));
      for (let i = 0; i < count; i++) {
        const y = 1 - (2 * (i + 0.5)) / count; // -1 to 1
        const rSlice = Math.sqrt(1 - y * y);
        const theta = 2 * Math.PI * (i + 1) / phi;
        offsets.push({
          north: Math.cos(theta) * rSlice * radius,
          east: Math.sin(theta) * rSlice * radius,
          alt: y * radius + altOffset
        });
      }
      break;
    }

    case "double_helix": {
      // Two interwoven spiral columns climbing vertically
      const helixRadius = spacing;
      const helixPitch = spacing * 1.2; // vertical rise per full revolution
      for (let i = 0; i < count; i++) {
        const strand = i % 2; // 0 or 1
        const pos = Math.floor(i / 2);
        const theta = (pos * Math.PI) / 3; // 60° per step
        const phaseOffset = strand * Math.PI; // second strand offset by 180°
        offsets.push({
          north: Math.cos(theta + phaseOffset) * helixRadius,
          east: Math.sin(theta + phaseOffset) * helixRadius,
          alt: pos * helixPitch / (2 * Math.PI) * Math.PI / 3 + altOffset
        });
      }
      break;
    }

    case "torus": {
      // 3D donut: major ring with minor ring cross-section
      const majorR = Math.max(spacing * 2, (count * spacing) / (2 * Math.PI));
      const minorR = spacing;
      const numMajorSteps = Math.ceil(Math.sqrt(count * 2));
      for (let i = 0; i < count; i++) {
        const majorIdx = i % numMajorSteps;
        const minorIdx = Math.floor(i / numMajorSteps);
        const numMinor = Math.ceil(count / numMajorSteps);
        const thetaMajor = (2 * Math.PI * majorIdx) / numMajorSteps;
        const thetaMinor = (2 * Math.PI * minorIdx) / numMinor;
        const r = majorR + minorR * Math.cos(thetaMinor);
        offsets.push({
          north: r * Math.cos(thetaMajor),
          east: r * Math.sin(thetaMajor),
          alt: minorR * Math.sin(thetaMinor) + altOffset
        });
      }
      break;
    }

    case "mobius": {
      // Möbius strip: a twisted loop — ribbon that twists 180° over one full revolution
      const mRadius = Math.max(spacing * 2, (count * spacing) / (2 * Math.PI));
      const mWidth = spacing;
      for (let i = 0; i < count; i++) {
        const t = (2 * Math.PI * i) / count; // position around loop
        const halfTwist = t / 2; // 180° twist over full revolution
        const side = (i % 2 === 0 ? 1 : -1) * mWidth * 0.5;
        offsets.push({
          north: (mRadius + side * Math.cos(halfTwist)) * Math.cos(t),
          east: (mRadius + side * Math.cos(halfTwist)) * Math.sin(t),
          alt: side * Math.sin(halfTwist) + altOffset
        });
      }
      break;
    }

    case "geodesic_dome": {
      // Buckminster Fuller sphere mesh — icosahedron-based vertex distribution on upper hemisphere
      const gRadius = Math.max(spacing, (count * spacing) / Math.PI);
      // Use Fibonacci lattice on upper hemisphere
      const phi2 = (1 + Math.sqrt(5)) / 2;
      for (let i = 0; i < count; i++) {
        const y = 1 - (i + 0.5) / count; // only upper hemisphere: y from 1 to 0
        const rSlice = Math.sqrt(1 - y * y);
        const theta = 2 * Math.PI * (i + 1) / phi2;
        offsets.push({
          north: Math.cos(theta) * rSlice * gRadius,
          east: Math.sin(theta) * rSlice * gRadius,
          alt: y * gRadius * 0.6 + altOffset
        });
      }
      break;
    }

    case "lissajous": {
      // Drones placed along a Lissajous curve (3:2 frequency ratio)
      const lAmp = spacing * Math.max(2, Math.sqrt(count));
      const ax = 3, ay = 2;
      for (let i = 0; i < count; i++) {
        const t = (2 * Math.PI * i) / count;
        offsets.push({
          north: Math.sin(ax * t) * lAmp,
          east: Math.sin(ay * t + Math.PI / 4) * lAmp,
          alt: altOffset
        });
      }
      break;
    }

    case "fractal_branch": {
      // Recursive branching formation (binary tree layout)
      // Level 0 = root (leader), level 1 = 2 branches, level 2 = 4, etc.
      const branchAngle = Math.PI / 5; // 36° spread
      const branchLength = spacing;
      const queue: Array<{ n: number; e: number; a: number; angle: number; depth: number }> = [
        { n: -branchLength, e: -branchLength * 0.3, a: 0, angle: -branchAngle, depth: 1 },
        { n: -branchLength, e: branchLength * 0.3, a: 0, angle: branchAngle, depth: 1 }
      ];
      let qi = 0;
      while (offsets.length < count && qi < queue.length) {
        const node = queue[qi++];
        offsets.push({ north: node.n, east: node.e, alt: node.a + altOffset });
        if (offsets.length >= count) break;
        const len = branchLength * Math.pow(0.7, node.depth);
        const childN1 = node.n + Math.cos(node.angle - branchAngle) * len;
        const childE1 = node.e + Math.sin(node.angle - branchAngle) * len;
        const childN2 = node.n + Math.cos(node.angle + branchAngle) * len;
        const childE2 = node.e + Math.sin(node.angle + branchAngle) * len;
        queue.push(
          { n: childN1, e: childE1, a: node.a + altOffset * 0.5, angle: node.angle - branchAngle, depth: node.depth + 1 },
          { n: childN2, e: childE2, a: node.a + altOffset * 0.5, angle: node.angle + branchAngle, depth: node.depth + 1 }
        );
      }
      // Fill remaining if tree is too shallow
      while (offsets.length < count) {
        offsets.push({ north: -(offsets.length + 1) * spacing * 0.5, east: 0, alt: altOffset });
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════
    // MILITARY / TACTICAL EXPANSION
    // ═══════════════════════════════════════════════════════════

    case "layered_wedge": {
      // Stacked V formations at increasing altitude
      const tiers = Math.max(2, Math.ceil(count / 6));
      let placed = 0;
      for (let tier = 0; tier < tiers && placed < count; tier++) {
        const tierCount = Math.ceil((count - placed) / (tiers - tier));
        for (let i = 0; i < tierCount && placed < count; i++) {
          const rank = Math.floor(i / 2) + 1;
          const side = i % 2 === 0 ? -1 : 1;
          offsets.push({
            north: -rank * spacing,
            east: side * rank * spacing,
            alt: tier * spacing * 0.8 + altOffset
          });
          placed++;
        }
      }
      break;
    }

    case "phalanx": {
      // Tight rectangular grid advancing — like a military block
      const pCols = Math.ceil(Math.sqrt(count * 1.5)); // wider than deep
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / pCols);
        const col = i % pCols;
        offsets.push({
          north: -(row + 1) * spacing * 0.8,
          east: (col - (pCols - 1) / 2) * spacing,
          alt: altOffset
        });
      }
      break;
    }

    case "funnel": {
      // Wide entrance narrowing to tight exit
      for (let i = 0; i < count; i++) {
        const rank = Math.floor(i / 2) + 1;
        const side = i % 2 === 0 ? -1 : 1;
        // Width narrows as rank increases
        const widthFactor = Math.max(0.2, 1 - rank / (count + 1));
        offsets.push({
          north: -rank * spacing,
          east: side * rank * spacing * widthFactor,
          alt: altOffset
        });
      }
      break;
    }

    case "offset_dual_grid": {
      // Two grids offset diagonally for redundant scanning
      const dCols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const layer = i < Math.ceil(count / 2) ? 0 : 1;
        const li = layer === 0 ? i : i - Math.ceil(count / 2);
        const row = Math.floor(li / dCols);
        const col = li % dCols;
        const offset = layer * spacing * 0.5; // diagonal offset for layer 2
        offsets.push({
          north: -(row * spacing + offset),
          east: (col - (dCols - 1) / 2) * spacing + offset,
          alt: layer * spacing * 0.6 + altOffset
        });
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════
    // CINEMATIC / VISUAL IMPACT
    // ═══════════════════════════════════════════════════════════

    case "radial_crown": {
      // Radial burst upward — crown / explosion shape
      const crownRadius = spacing * 1.5;
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        const riseAmt = spacing * (0.5 + Math.abs(Math.sin(angle * 2)) * 1.5);
        offsets.push({
          north: Math.cos(angle) * crownRadius,
          east: Math.sin(angle) * crownRadius,
          alt: riseAmt + altOffset
        });
      }
      break;
    }

    case "vertical_wave": {
      // Drones form a vertical wall that has a sine wave ripple
      const waveCols = count;
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * spacing;
        const waveAlt = Math.sin((i / count) * 2 * Math.PI) * spacing * 1.5;
        offsets.push({
          north: 0,
          east: x,
          alt: waveAlt + altOffset
        });
      }
      break;
    }

    case "starburst": {
      // Radial straight-line outward rays from center
      const arms = Math.max(3, Math.ceil(count / 3));
      for (let i = 0; i < count; i++) {
        const arm = i % arms;
        const armRank = Math.floor(i / arms) + 1;
        const armAngle = (2 * Math.PI * arm) / arms;
        offsets.push({
          north: Math.cos(armAngle) * armRank * spacing,
          east: Math.sin(armAngle) * armRank * spacing,
          alt: altOffset
        });
      }
      break;
    }

    case "dna_ladder": {
      // Two parallel vertical strands with cross-connectors
      const ladderSpacing = spacing * 0.6;
      for (let i = 0; i < count; i++) {
        const rung = Math.floor(i / 2);
        const strand = i % 2;
        const twist = (rung * Math.PI) / 4; // gentle twist per rung
        const sideOffset = strand === 0 ? -spacing * 0.5 : spacing * 0.5;
        offsets.push({
          north: Math.cos(twist) * sideOffset,
          east: Math.sin(twist) * sideOffset,
          alt: rung * ladderSpacing + altOffset
        });
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════
    // SURVEILLANCE / COVERAGE
    // ═══════════════════════════════════════════════════════════

    case "concentric_rings": {
      // Multiple circles at different radii
      const numRings = Math.max(2, Math.ceil(Math.sqrt(count / 3)));
      let placed = 0;
      for (let ring = 1; ring <= numRings && placed < count; ring++) {
        const r = ring * spacing;
        const ringCount = Math.min(
          Math.ceil((count - placed) / (numRings - ring + 1)),
          Math.floor(2 * Math.PI * r / spacing)
        );
        for (let j = 0; j < ringCount && placed < count; j++) {
          const angle = (2 * Math.PI * j) / ringCount;
          offsets.push({
            north: Math.cos(angle) * r,
            east: Math.sin(angle) * r,
            alt: altOffset
          });
          placed++;
        }
      }
      break;
    }

    case "sector_fan": {
      // Pie slice scanning forward
      const fanAngle = (120 * Math.PI) / 180; // 120° sector
      const fanRings = Math.max(2, Math.ceil(Math.sqrt(count)));
      let placed = 0;
      for (let ring = 1; ring <= fanRings && placed < count; ring++) {
        const r = ring * spacing;
        const arcCount = Math.ceil(count / fanRings);
        for (let j = 0; j < arcCount && placed < count; j++) {
          const angle = -fanAngle / 2 + (fanAngle * j) / Math.max(1, arcCount - 1);
          offsets.push({
            north: Math.cos(angle) * r,
            east: Math.sin(angle) * r,
            alt: altOffset
          });
          placed++;
        }
      }
      break;
    }

    case "checkerboard": {
      // Alternating grid positions like a chessboard
      const cbCols = Math.ceil(Math.sqrt(count * 2));
      let placed = 0;
      let row = 0;
      while (placed < count) {
        for (let col = 0; col < cbCols && placed < count; col++) {
          // Skip squares in checkerboard pattern
          if ((row + col) % 2 !== 0) continue;
          offsets.push({
            north: -row * spacing,
            east: (col - (cbCols - 1) / 2) * spacing,
            alt: altOffset
          });
          placed++;
        }
        row++;
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════
    // 3D PLATONIC SOLIDS & STRUCTURES
    // ═══════════════════════════════════════════════════════════

    case "tetrahedron": {
      // 4 vertices of a regular tetrahedron, plus extras interpolated along edges
      const tSize = spacing * 1.5;
      const vertices = [
        { north: tSize, east: 0, alt: -tSize * 0.4 },
        { north: -tSize * 0.5, east: tSize * 0.866, alt: -tSize * 0.4 },
        { north: -tSize * 0.5, east: -tSize * 0.866, alt: -tSize * 0.4 },
        { north: 0, east: 0, alt: tSize * 0.8 }
      ];
      for (let i = 0; i < count; i++) {
        if (i < vertices.length) {
          offsets.push({ ...vertices[i], alt: vertices[i].alt + altOffset });
        } else {
          // Interpolate along edges
          const edgeIdx = (i - vertices.length) % 6;
          const edges = [[0,1],[1,2],[2,0],[0,3],[1,3],[2,3]];
          const [a, b] = edges[edgeIdx];
          const t = ((i - vertices.length) / 6 + 0.5) / (Math.ceil((count - 4) / 6) + 1);
          offsets.push({
            north: vertices[a].north + (vertices[b].north - vertices[a].north) * t,
            east: vertices[a].east + (vertices[b].east - vertices[a].east) * t,
            alt: vertices[a].alt + (vertices[b].alt - vertices[a].alt) * t + altOffset
          });
        }
      }
      break;
    }

    case "cube_3d": {
      // 8 vertices of a cube, plus extras on edges/faces
      const cSize = spacing;
      const cubeVerts = [
        { north: cSize, east: cSize, alt: cSize },
        { north: cSize, east: -cSize, alt: cSize },
        { north: -cSize, east: cSize, alt: cSize },
        { north: -cSize, east: -cSize, alt: cSize },
        { north: cSize, east: cSize, alt: -cSize },
        { north: cSize, east: -cSize, alt: -cSize },
        { north: -cSize, east: cSize, alt: -cSize },
        { north: -cSize, east: -cSize, alt: -cSize }
      ];
      for (let i = 0; i < count; i++) {
        if (i < cubeVerts.length) {
          offsets.push({ ...cubeVerts[i], alt: cubeVerts[i].alt + altOffset });
        } else {
          // Fill edges: 12 edges
          const edgeList: [number, number][] = [
            [0,1],[0,2],[1,3],[2,3],[4,5],[4,6],[5,7],[6,7],[0,4],[1,5],[2,6],[3,7]
          ];
          const eIdx = (i - 8) % edgeList.length;
          const t = ((Math.floor((i - 8) / 12) + 1)) / (Math.ceil((count - 8) / 12) + 1);
          const [a, b] = edgeList[eIdx];
          offsets.push({
            north: cubeVerts[a].north + (cubeVerts[b].north - cubeVerts[a].north) * t,
            east: cubeVerts[a].east + (cubeVerts[b].east - cubeVerts[a].east) * t,
            alt: cubeVerts[a].alt + (cubeVerts[b].alt - cubeVerts[a].alt) * t + altOffset
          });
        }
      }
      break;
    }

    case "octahedron": {
      // 6 vertices of a regular octahedron
      const oSize = spacing * 1.5;
      const octVerts = [
        { north: oSize, east: 0, alt: 0 },
        { north: -oSize, east: 0, alt: 0 },
        { north: 0, east: oSize, alt: 0 },
        { north: 0, east: -oSize, alt: 0 },
        { north: 0, east: 0, alt: oSize },
        { north: 0, east: 0, alt: -oSize }
      ];
      const octEdges: [number, number][] = [
        [0,2],[2,1],[1,3],[3,0],[0,4],[2,4],[1,4],[3,4],[0,5],[2,5],[1,5],[3,5]
      ];
      for (let i = 0; i < count; i++) {
        if (i < octVerts.length) {
          offsets.push({ ...octVerts[i], alt: octVerts[i].alt + altOffset });
        } else {
          const eIdx = (i - 6) % octEdges.length;
          const t = ((Math.floor((i - 6) / 12) + 1)) / (Math.ceil((count - 6) / 12) + 1);
          const [a, b] = octEdges[eIdx];
          offsets.push({
            north: octVerts[a].north + (octVerts[b].north - octVerts[a].north) * t,
            east: octVerts[a].east + (octVerts[b].east - octVerts[a].east) * t,
            alt: octVerts[a].alt + (octVerts[b].alt - octVerts[a].alt) * t + altOffset
          });
        }
      }
      break;
    }

    case "icosahedron": {
      // 12 vertices of a regular icosahedron
      const iSize = spacing * 1.5;
      const icoGolden = (1 + Math.sqrt(5)) / 2;
      const iNorm = iSize / Math.sqrt(1 + icoGolden * icoGolden);
      const iA = iNorm;
      const iB = iNorm * icoGolden;
      const icoVerts = [
        { north: 0, east: iA, alt: iB }, { north: 0, east: -iA, alt: iB },
        { north: 0, east: iA, alt: -iB }, { north: 0, east: -iA, alt: -iB },
        { north: iA, east: iB, alt: 0 }, { north: -iA, east: iB, alt: 0 },
        { north: iA, east: -iB, alt: 0 }, { north: -iA, east: -iB, alt: 0 },
        { north: iB, east: 0, alt: iA }, { north: -iB, east: 0, alt: iA },
        { north: iB, east: 0, alt: -iA }, { north: -iB, east: 0, alt: -iA }
      ];
      for (let i = 0; i < count; i++) {
        if (i < icoVerts.length) {
          offsets.push({ ...icoVerts[i], alt: icoVerts[i].alt + altOffset });
        } else {
          // Wrap vertices for additional drones, spreading along edges
          const vi = i % icoVerts.length;
          const nextVi = (vi + 1) % icoVerts.length;
          const t = (Math.floor(i / icoVerts.length)) / (Math.ceil(count / icoVerts.length));
          offsets.push({
            north: icoVerts[vi].north + (icoVerts[nextVi].north - icoVerts[vi].north) * t * 0.5,
            east: icoVerts[vi].east + (icoVerts[nextVi].east - icoVerts[vi].east) * t * 0.5,
            alt: icoVerts[vi].alt + (icoVerts[nextVi].alt - icoVerts[vi].alt) * t * 0.5 + altOffset
          });
        }
      }
      break;
    }

    case "dodecahedron": {
      // 20 vertices of a regular dodecahedron
      const dSize = spacing;
      const dGolden = (1 + Math.sqrt(5)) / 2;
      const dInvGolden = 1 / dGolden;
      const dodecVerts: Offset[] = [];
      // Cube vertices (±1, ±1, ±1)
      for (const sn of [-1, 1]) {
        for (const se of [-1, 1]) {
          for (const sa of [-1, 1]) {
            dodecVerts.push({ north: sn * dSize, east: se * dSize, alt: sa * dSize });
          }
        }
      }
      // Rectangle vertices on each axis pair
      for (const s1 of [-1, 1]) {
        for (const s2 of [-1, 1]) {
          dodecVerts.push({ north: 0, east: s1 * dInvGolden * dSize, alt: s2 * dGolden * dSize });
          dodecVerts.push({ north: s1 * dGolden * dSize, east: 0, alt: s2 * dInvGolden * dSize });
          dodecVerts.push({ north: s1 * dInvGolden * dSize, east: s2 * dGolden * dSize, alt: 0 });
        }
      }
      for (let i = 0; i < count; i++) {
        if (i < dodecVerts.length) {
          offsets.push({ ...dodecVerts[i], alt: dodecVerts[i].alt + altOffset });
        } else {
          // Wrap around vertices
          const vi = i % dodecVerts.length;
          offsets.push({ ...dodecVerts[vi], alt: dodecVerts[vi].alt + altOffset + (Math.floor(i / dodecVerts.length)) * spacing * 0.3 });
        }
      }
      break;
    }

    case "diamond_lattice": {
      // 3D lattice grid — FCC-like crystal structure
      const dlSpacing = spacing;
      const dlCols = Math.ceil(Math.cbrt(count * 2));
      let placed = 0;
      for (let z = 0; placed < count; z++) {
        for (let y = 0; y < dlCols && placed < count; y++) {
          for (let x = 0; x < dlCols && placed < count; x++) {
            // FCC: base position + face-center offset on alternating layers
            const fccOffset = (z % 2 === 0) ? 0 : dlSpacing * 0.5;
            offsets.push({
              north: (x - (dlCols - 1) / 2) * dlSpacing + fccOffset,
              east: (y - (dlCols - 1) / 2) * dlSpacing + fccOffset,
              alt: z * dlSpacing * 0.707 + altOffset
            });
            placed++;
          }
        }
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════
    // NEXT-LEVEL
    // ═══════════════════════════════════════════════════════════

    case "mirrored_split": {
      // Formation splits into two mirrored halves
      const halfCount = Math.ceil(count / 2);
      const mirrorGap = spacing * 1.5;
      for (let i = 0; i < count; i++) {
        const half = i < halfCount ? 0 : 1;
        const hi = half === 0 ? i : i - halfCount;
        const rank = hi + 1;
        const side = half === 0 ? -1 : 1;
        offsets.push({
          north: -rank * spacing * 0.7,
          east: side * mirrorGap + side * (hi % 3) * spacing * 0.5,
          alt: altOffset
        });
      }
      break;
    }

    case "parametric_surface": {
      // Oscillating surface: z = sin(x) * cos(y)
      const psCols = Math.ceil(Math.sqrt(count));
      const psSpacing = spacing;
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / psCols);
        const col = i % psCols;
        const x = (col - (psCols - 1) / 2) * psSpacing;
        const y = (row - (psCols - 1) / 2) * psSpacing;
        const z = Math.sin(x / psSpacing * Math.PI * 0.5) * Math.cos(y / psSpacing * Math.PI * 0.5) * psSpacing;
        offsets.push({
          north: y,
          east: x,
          alt: z + altOffset
        });
      }
      break;
    }

    default: {
      // Fallback: column
      for (let i = 0; i < count; i++) {
        offsets.push({ north: -(i + 1) * spacing, east: 0, alt: 0 });
      }
    }
  }

  return offsets;
}

export class SwarmEngine {
  computeFollowerTargets(
    leader: {
      lat: number;
      lon: number;
      alt: number;
      heading?: number;
      vNorth?: number;
      vEast?: number;
    },
    droneIds: string[],
    params: FormationParams,
    predictAheadSec?: number
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> {
    // Extrapolate leader position forward to compensate for follower lag
    let leaderLat = leader.lat;
    let leaderLon = leader.lon;
    let leaderAlt = leader.alt;

    if (predictAheadSec && predictAheadSec > 0) {
      const vN = leader.vNorth ?? 0;
      const vE = leader.vEast ?? 0;
      if (vN !== 0 || vE !== 0) {
        const predicted = offsetLatLon(
          leaderLat,
          leaderLon,
          vN * predictAheadSec,
          vE * predictAheadSec
        );
        leaderLat = predicted.lat;
        leaderLon = predicted.lon;
      }
    }

    const offsets = generateOffsets(
      params.formation,
      droneIds.length,
      params.spacing,
      params.altOffset
    );

    return droneIds.map((droneId, idx) => {
      const raw = offsets[idx];
      const rotated = rotateOffset(raw.north, raw.east, params.headingDeg);
      const point = offsetLatLon(leaderLat, leaderLon, rotated.north, rotated.east);
      return {
        droneId,
        lat: point.lat,
        lon: point.lon,
        alt: leaderAlt + raw.alt
      };
    });
  }

  computeAnchoredFormationTargets(
    anchor: {
      lat: number;
      lon: number;
      alt: number;
      heading?: number;
      vNorth?: number;
      vEast?: number;
    },
    leaderId: string,
    followerIds: string[],
    params: FormationParams,
    predictAheadSec?: number
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> {
    let anchorLat = anchor.lat;
    let anchorLon = anchor.lon;

    if (predictAheadSec && predictAheadSec > 0) {
      const vN = anchor.vNorth ?? 0;
      const vE = anchor.vEast ?? 0;
      if (vN !== 0 || vE !== 0) {
        const predicted = offsetLatLon(
          anchorLat,
          anchorLon,
          vN * predictAheadSec,
          vE * predictAheadSec
        );
        anchorLat = predicted.lat;
        anchorLon = predicted.lon;
      }
    }

    return [
      {
        droneId: leaderId,
        lat: anchorLat,
        lon: anchorLon,
        alt: anchor.alt
      },
      ...this.computeFollowerTargets(
        { ...anchor, lat: anchorLat, lon: anchorLon },
        followerIds,
        params,
        0
      )
    ];
  }
}
