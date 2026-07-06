use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::state::Handover;

pub fn checkin(ctx: Context<Checkin>) -> Result<()> {
    ctx.accounts.handover.last_checkin = Clock::get()?.unix_timestamp;
    Ok(())
}

#[derive(Accounts)]
pub struct Checkin<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"handover", owner.key().as_ref(), mint.key().as_ref(), beneficiary.key().as_ref()],
        bump = handover.bump,
        has_one = owner,
    )]
    pub handover: Account<'info, Handover>,
    pub mint: Account<'info, Mint>,
    /// CHECK: beneficiary is checked in the handover account
    pub beneficiary: UncheckedAccount<'info>,
}

