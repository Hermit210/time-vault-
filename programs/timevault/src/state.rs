use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Handover {
    pub owner: Pubkey,
    pub beneficiary: Pubkey,
    pub token_account: Pubkey,
    pub mint: Pubkey,
    pub last_checkin: i64,
    pub timeout: i64,
    pub bump: u8,
}
