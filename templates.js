'use strict';
// Möbel-Vorlagen (Maße in cm). s = Form: rect | round | L; t = Schenkelbreite der L-Form
const CATS = {
  schlafen: { name: 'Schlafen', col: '#5b8def' },
  wohnen: { name: 'Wohnen', col: '#ff9f43' },
  essen: { name: 'Essen & Küche', col: '#19c3a6' },
  arbeiten: { name: 'Arbeiten', col: '#9b6bff' },
  stauraum: { name: 'Stauraum', col: '#ff6b81' },
  bad: { name: 'Bad', col: '#2ec5ff' },
  sonst: { name: 'Sonstiges', col: '#f2b01e' },
  eigene: { name: 'Eigene', col: '#7bd34f' }
};
const COLORS = ['#5b8def', '#ff9f43', '#19c3a6', '#9b6bff', '#ff6b81', '#2ec5ff', '#f2b01e', '#7bd34f', '#ff7f50', '#b39ddb', '#a1887f', '#90a4ae'];

const TEMPLATES = [
  { n: 'Doppelbett', s: 'rect', w: 160, d: 200, c: 'schlafen' },
  { n: 'Bett', s: 'rect', w: 140, d: 200, c: 'schlafen' },
  { n: 'Einzelbett', s: 'rect', w: 90, d: 200, c: 'schlafen' },
  { n: 'Kinderbett', s: 'rect', w: 70, d: 140, c: 'schlafen' },
  { n: 'Nachttisch', s: 'rect', w: 40, d: 40, c: 'schlafen' },

  { n: 'Sofa 2er', s: 'rect', w: 160, d: 90, c: 'wohnen' },
  { n: 'Sofa 3er', s: 'rect', w: 210, d: 90, c: 'wohnen' },
  { n: 'Ecksofa', s: 'L', w: 280, d: 200, t: 90, c: 'wohnen' },
  { n: 'Sessel', s: 'rect', w: 80, d: 80, c: 'wohnen' },
  { n: 'Couchtisch', s: 'rect', w: 100, d: 55, c: 'wohnen' },
  { n: 'Couchtisch rund', s: 'round', w: 70, d: 70, c: 'wohnen' },
  { n: 'TV-Board', s: 'rect', w: 160, d: 40, c: 'wohnen' },

  { n: 'Esstisch', s: 'rect', w: 160, d: 90, c: 'essen' },
  { n: 'Esstisch rund', s: 'round', w: 110, d: 110, c: 'essen' },
  { n: 'Stuhl', s: 'rect', w: 45, d: 45, c: 'essen' },
  { n: 'Kühlschrank', s: 'rect', w: 60, d: 65, c: 'essen' },
  { n: 'Spülmaschine', s: 'rect', w: 60, d: 60, c: 'essen' },
  { n: 'Küchenzeile', s: 'rect', w: 240, d: 60, c: 'essen' },
  { n: 'Küche L-Form', s: 'L', w: 300, d: 240, t: 60, c: 'essen' },
  { n: 'Kücheninsel', s: 'rect', w: 120, d: 60, c: 'essen' },

  { n: 'Schreibtisch', s: 'rect', w: 140, d: 70, c: 'arbeiten' },
  { n: 'Eck-Schreibtisch', s: 'L', w: 160, d: 140, t: 60, c: 'arbeiten' },
  { n: 'Bürostuhl', s: 'round', w: 60, d: 60, c: 'arbeiten' },
  { n: 'Rollcontainer', s: 'rect', w: 40, d: 55, c: 'arbeiten' },

  { n: 'Kleiderschrank', s: 'rect', w: 200, d: 60, c: 'stauraum' },
  { n: 'Schrank', s: 'rect', w: 100, d: 50, c: 'stauraum' },
  { n: 'Kommode', s: 'rect', w: 120, d: 50, c: 'stauraum' },
  { n: 'Regal', s: 'rect', w: 80, d: 30, c: 'stauraum' },
  { n: 'Bücherregal', s: 'rect', w: 100, d: 30, c: 'stauraum' },
  { n: 'Schuhschrank', s: 'rect', w: 80, d: 35, c: 'stauraum' },

  { n: 'Badewanne', s: 'rect', w: 170, d: 75, c: 'bad' },
  { n: 'Dusche', s: 'rect', w: 90, d: 90, c: 'bad' },
  { n: 'WC', s: 'rect', w: 40, d: 70, c: 'bad' },
  { n: 'Waschbecken', s: 'rect', w: 60, d: 45, c: 'bad' },
  { n: 'Waschmaschine', s: 'rect', w: 60, d: 60, c: 'bad' },

  { n: 'Teppich', s: 'rect', w: 200, d: 300, c: 'sonst', ghost: true },
  { n: 'Pflanze', s: 'round', w: 40, d: 40, c: 'sonst' },
  { n: 'Kiste', s: 'rect', w: 100, d: 60, c: 'sonst' },
  { n: 'Rund', s: 'round', w: 80, d: 80, c: 'sonst' },
  { n: 'L-Form', s: 'L', w: 150, d: 150, t: 60, c: 'sonst' }
];
