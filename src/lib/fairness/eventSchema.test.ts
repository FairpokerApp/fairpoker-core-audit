import {validateTableEvent, validateRoundSettings} from "./eventSchema";

const validSettings = {
  initialFundAmount: 100,
  smallBlindAmount: 1,
  bigBlindAmount: 2,
};

describe('validateRoundSettings', () => {
  it('accepts well-formed settings', () => {
    expect(validateRoundSettings(validSettings).ok).toBe(true);
  });

  it('accepts settings with only the required field', () => {
    expect(validateRoundSettings({initialFundAmount: 50}).ok).toBe(true);
  });

  it('rejects non-object settings', () => {
    expect(validateRoundSettings(null).ok).toBe(false);
    expect(validateRoundSettings('x').ok).toBe(false);
  });

  it('rejects missing or non-finite initialFundAmount', () => {
    expect(validateRoundSettings({}).ok).toBe(false);
    expect(validateRoundSettings({initialFundAmount: NaN}).ok).toBe(false);
    expect(validateRoundSettings({initialFundAmount: Infinity}).ok).toBe(false);
    expect(validateRoundSettings({initialFundAmount: '100'}).ok).toBe(false);
  });

  it('rejects non-finite optional numeric fields', () => {
    expect(validateRoundSettings({initialFundAmount: 100, smallBlindAmount: NaN}).ok).toBe(false);
    expect(validateRoundSettings({initialFundAmount: 100, bits: 'big'}).ok).toBe(false);
  });

  it('rejects non-string participants', () => {
    expect(validateRoundSettings({initialFundAmount: 100, participants: [1, 2]}).ok).toBe(false);
    expect(validateRoundSettings({initialFundAmount: 100, participants: ['a', 'b']}).ok).toBe(true);
  });
});

describe('validateTableEvent', () => {
  it('accepts a well-formed newRound', () => {
    expect(validateTableEvent({
      type: 'newRound',
      round: 1,
      players: ['a', 'b'],
      settings: validSettings,
    }).ok).toBe(true);
  });

  it('accepts well-formed bet/fold/voidHandVote', () => {
    expect(validateTableEvent({type: 'action/bet', round: 1, amount: 2}).ok).toBe(true);
    expect(validateTableEvent({type: 'action/bet', round: 1, amount: 0}).ok).toBe(true);
    expect(validateTableEvent({type: 'action/fold', round: 1}).ok).toBe(true);
    expect(validateTableEvent({type: 'action/voidHandVote', round: 1, approve: true}).ok).toBe(true);
  });

  it('accepts lifecycle events with or without round', () => {
    expect(validateTableEvent({type: 'action/sitOut'}).ok).toBe(true);
    expect(validateTableEvent({type: 'action/sitOut', round: null}).ok).toBe(true);
    expect(validateTableEvent({type: 'action/returnToTable', round: 3}).ok).toBe(true);
    expect(validateTableEvent({type: 'action/openRegistration'}).ok).toBe(true);
  });

  it('accepts a well-formed hand/result and rejects a malformed one', () => {
    expect(validateTableEvent({type: 'hand/result', round: 1}).ok).toBe(true);
    expect(validateTableEvent({type: 'hand/result'}).ok).toBe(false);
    expect(validateTableEvent({type: 'hand/result', round: NaN}).ok).toBe(false);
    expect(validateTableEvent({type: 'hand/result', round: 'x'}).ok).toBe(false);
  });

  it('rejects non-object or missing type', () => {
    expect(validateTableEvent(null).ok).toBe(false);
    expect(validateTableEvent({}).ok).toBe(false);
    expect(validateTableEvent({type: 42}).ok).toBe(false);
    expect(validateTableEvent({type: 'totally/unknown'}).ok).toBe(false);
  });

  it('rejects malformed newRound', () => {
    expect(validateTableEvent({type: 'newRound', round: 1, players: ['a'], settings: validSettings}).ok).toBe(false);
    expect(validateTableEvent({type: 'newRound', round: NaN, players: ['a', 'b'], settings: validSettings}).ok).toBe(false);
    expect(validateTableEvent({type: 'newRound', round: 1, players: ['a', ''], settings: validSettings}).ok).toBe(false);
    expect(validateTableEvent({type: 'newRound', round: 1, players: ['a', 'b'], settings: {}}).ok).toBe(false);
  });

  it('rejects malformed bet amounts (NaN, Infinity, negative, string, fractional, oversized)', () => {
    expect(validateTableEvent({type: 'action/bet', round: 1, amount: NaN}).ok).toBe(false);
    expect(validateTableEvent({type: 'action/bet', round: 1, amount: Infinity}).ok).toBe(false);
    expect(validateTableEvent({type: 'action/bet', round: 1, amount: -5}).ok).toBe(false);
    expect(validateTableEvent({type: 'action/bet', round: 1, amount: '2'}).ok).toBe(false);
    expect(validateTableEvent({type: 'action/bet', round: 1, amount: 2.5}).ok).toBe(false);
    expect(validateTableEvent({type: 'action/bet', round: 1, amount: Number.MAX_SAFE_INTEGER + 1}).ok).toBe(false);
  });

  it('rejects autoFold without a valid target', () => {
    expect(validateTableEvent({type: 'action/autoFold', round: 1}).ok).toBe(false);
    expect(validateTableEvent({type: 'action/autoFold', round: 1, target: ''}).ok).toBe(false);
    expect(validateTableEvent({type: 'action/autoFold', round: 1, target: 'a'}).ok).toBe(true);
  });
});
