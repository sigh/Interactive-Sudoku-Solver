# Uncovering tunnels by Vythic
# https://sudokupad.app/y323plq5im

# Sandbox code

# const ARROW_DEFS = [
#   { origin: 'R6C1', arm: ['CC46', 'CC37', 'CC28', 'CC19', 'CC10', 'CC1'] },
#   { origin: 'R3C2', arm: ['CC20', 'CC29', 'CC38', 'CC47', 'CC56', 'CC65', 'CC74'] },
#   { origin: 'R3C3', arm: ['CC21', 'CC30', 'CC39', 'CC48', 'CC57', 'CC66', 'CC75'] },
#   { origin: 'R1C3', arm: ['CC3', 'CC4', 'CC5', 'CC6', 'CC7', 'CC8', 'CC9'] },
#   { origin: 'R1C4', arm: ['CC4', 'CC12', 'CC20', 'CC28'] },
#   { origin: 'R3C5', arm: ['CC23', 'CC14', 'CC5'] },
#   { origin: 'R3C5', arm: ['CC23', 'CC15', 'CC7'] },
#   { origin: 'R2C8', arm: ['CC17', 'CC16', 'CC15', 'CC14', 'CC13', 'CC12', 'CC11', 'CC10'] },
#   { origin: 'R4C7', arm: ['CC34', 'CC33', 'CC32', 'CC31', 'CC30', 'CC29', 'CC28'] },
#   { origin: 'R5C4', arm: ['CC40', 'CC49', 'CC58', 'CC67', 'CC76'] },
#   { origin: 'R7C5', arm: ['CC59', 'CC68', 'CC77'] },
#   { origin: 'R7C5', arm: ['CC59', 'CC67', 'CC75'] },
#   { origin: 'R8C7', arm: ['CC70', 'CC71', 'CC72'] },
#   { origin: 'R7C9', arm: ['CC63', 'CC54', 'CC45', 'CC36', 'CC27', 'CC18', 'CC9'] },
#   { origin: 'R6C6', arm: ['CC51', 'CC52', 'CC53', 'CC54'] },
# ];
#
# const ORANGE_LINE_PAIRS = [
#   ['R6C1', 'R6C2'],
#   ['R2C7', 'R3C7'],
#   ['R3C6', 'R4C6'],
#   ['R4C7', 'R5C6'],
#   ['R4C9', 'R5C8'],
#   ['R6C5', 'R7C6'],
#   ['R7C7', 'R7C8'],
#   ['R7C3', 'R8C3'],
# ];
#
# const CIRCLE_CELLS = [
#   'R1C2', 'R2C8', 'R3C6', 'R4C7', 'R5C3', 'R6C4', 'R7C4', 'R8C8', 'R9C6',
# ];
#
# // NFA: Opposite-parity count (arrow cells, over digit values only)
# // Cell sequence: [arrow_cell, dir_cell_1, dir_cell_2, ...]
# const parityCountSpec = {
#   startState: null,
#   transition(state, value) {
#     if (state === null) return { target: value, count: 0 };
#     const newCount = state.count + ((value % 2) !== (state.target % 2) ? 1 : 0);
#     if (newCount > state.target) return undefined;
#     return { target: state.target, count: newCount };
#   },
#   accept: (state) => state !== null && state.count === state.target,
# };
#
# const parityCountNFA = NFA.encodeSpec(parityCountSpec, 9);
#
# // Helpers
#
# const ccToGrid = (ccId) => {
#   const n = +ccId.slice(2) - 1;
#   return `R${Math.floor(n / 9) + 1}C${(n % 9) + 1}`;
# };
#
# const gridToCC = (cellId) => {
#   const r = +cellId.match(/R(\d+)/)[1];
#   const c = +cellId.match(/C(\d+)/)[1];
#   return `CC${(r - 1) * 9 + c}`;
# };
#
# const rowCC = (row) => Array.from({ length: 9 }, (_, i) => `CC${(row - 1) * 9 + i + 1}`);
#
# // Build constraints
#
# const chaosArrows = ARROW_DEFS.map(({ origin, arm }) => new ChaosArrow(origin, 1, ...arm));
#
# const parityCounts = ARROW_DEFS.map(({ origin, arm }) =>
#   new NFA(parityCountNFA, 'ParityCount', origin, ...arm.slice(1).map(ccToGrid))
# );
#
# const orangeLines = ORANGE_LINE_PAIRS.flatMap(([a, b]) => [
#   new Whisper(4, a, b),
#   new AllDifferent(gridToCC(a), gridToCC(b)),
# ]);
#
# const circles = CIRCLE_CELLS.map(cell => {
#   const row = +cell.match(/R(\d+)/)[1];
#   return new CountDistinct(cell, ...rowCC(row));
# });
#
# return [
#   new Shape('9x9'),
#   new ChaosConstruction(),
#   new NoBoxes(),
#   ...chaosArrows,
#   ...parityCounts,
#   ...orangeLines,
#   ...circles,
# ];

.ChaosConstruction
.NoBoxes
.ChaosArrow~R6C1~1~CC46~CC37~CC28~CC19~CC10~CC1
.ChaosArrow~R3C2~1~CC20~CC29~CC38~CC47~CC56~CC65~CC74
.ChaosArrow~R3C3~1~CC21~CC30~CC39~CC48~CC57~CC66~CC75
.ChaosArrow~R1C3~1~CC3~CC4~CC5~CC6~CC7~CC8~CC9
.ChaosArrow~R1C4~1~CC4~CC12~CC20~CC28
.ChaosArrow~R3C5~1~CC23~CC14~CC5
.ChaosArrow~R3C5~1~CC23~CC15~CC7
.ChaosArrow~R2C8~1~CC17~CC16~CC15~CC14~CC13~CC12~CC11~CC10
.ChaosArrow~R4C7~1~CC34~CC33~CC32~CC31~CC30~CC29~CC28
.ChaosArrow~R5C4~1~CC40~CC49~CC58~CC67~CC76
.ChaosArrow~R7C5~1~CC59~CC68~CC77
.ChaosArrow~R7C5~1~CC59~CC67~CC75
.ChaosArrow~R8C7~1~CC70~CC71~CC72
.ChaosArrow~R7C9~1~CC63~CC54~CC45~CC36~CC27~CC18~CC9
.ChaosArrow~R6C6~1~CC51~CC52~CC53~CC54
.Whisper~4~R6C1~R6C2
.Whisper~4~R2C7~R3C7
.Whisper~4~R3C6~R4C6
.Whisper~4~R4C7~R5C6
.Whisper~4~R4C9~R5C8
.Whisper~4~R6C5~R7C6
.Whisper~4~R7C7~R7C8
.Whisper~4~R7C3~R8C3
.AllDifferent~CC46~CC47
.AllDifferent~CC16~CC25
.AllDifferent~CC24~CC33
.AllDifferent~CC34~CC42
.AllDifferent~CC36~CC44
.AllDifferent~CC50~CC60
.AllDifferent~CC61~CC62
.AllDifferent~CC57~CC66
.CountDistinct~R1C2~CC1~CC2~CC3~CC4~CC5~CC6~CC7~CC8~CC9
.CountDistinct~R2C8~CC10~CC11~CC12~CC13~CC14~CC15~CC16~CC17~CC18
.CountDistinct~R3C6~CC19~CC20~CC21~CC22~CC23~CC24~CC25~CC26~CC27
.CountDistinct~R4C7~CC28~CC29~CC30~CC31~CC32~CC33~CC34~CC35~CC36
.CountDistinct~R5C3~CC37~CC38~CC39~CC40~CC41~CC42~CC43~CC44~CC45
.CountDistinct~R6C4~CC46~CC47~CC48~CC49~CC50~CC51~CC52~CC53~CC54
.CountDistinct~R7C4~CC55~CC56~CC57~CC58~CC59~CC60~CC61~CC62~CC63
.CountDistinct~R8C8~CC64~CC65~CC66~CC67~CC68~CC69~CC70~CC71~CC72
.CountDistinct~R9C6~CC73~CC74~CC75~CC76~CC77~CC78~CC79~CC80~CC81
.NFA~UgIn_GQpjoSpdVCEIQqoQhC_4wjCMIwj_7CMIwjCM_5WlaVpWl_7jOM4zjO_53ned53n_8EQRBEEQ_6YpimKYp_8lSVJUlS_65rmua5r_4mCYJgmC_7RtG0bRt_5HEcRxHE_7yvK8ryv_5oGgaBoG_8TxPE8Tx_6JIkiSJI_80zTNM0z~_ParityCount~R6C1~R5C1~R4C1~R3C1~R2C1~R1C1~~R3C2~R4C2~R5C2~R6C2~R7C2~R8C2~R9C2~~R3C3~R4C3~R5C3~R6C3~R7C3~R8C3~R9C3~~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9~~R1C4~R2C3~R3C2~R4C1~~R3C5~R2C5~R1C5~~R3C5~R2C6~R1C7~~R2C8~R2C7~R2C6~R2C5~R2C4~R2C3~R2C2~R2C1~~R4C7~R4C6~R4C5~R4C4~R4C3~R4C2~R4C1~~R5C4~R6C4~R7C4~R8C4~R9C4~~R7C5~R8C5~R9C5~~R7C5~R8C4~R9C3~~R8C7~R8C8~R8C9~~R7C9~R6C9~R5C9~R4C9~R3C9~R2C9~R1C9~~R6C6~R6C7~R6C8~R6C9