use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

use crate::state::Handover;
use crate::error::ErrorCode;

pub fn initialize(ctx: Context<Initialize>, timeout: i64) -> Result<()> {
    require!(timeout > 0, ErrorCode::InvalidTimeout);
    let handover = &mut ctx.accounts.handover;
    handover.owner = ctx.accounts.owner.key();
    handover.beneficiary = ctx.accounts.beneficiary.key();
    handover.token_account = ctx.accounts.token_account.key();
    handover.mint = ctx.accounts.mint.key();
    handover.last_checkin = Clock::get()?.unix_timestamp;
    handover.timeout = timeout;
    handover.bump = ctx.bumps.handover;

    // Delegate unlimited amount to PDA
    token::approve(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Approve {
                to: ctx.accounts.token_account.to_account_info(),
                delegate: ctx.accounts.handover.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        u64::MAX,
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + 32 * 4 + 8 * 2 + 1,
        seeds = [b"handover", owner.key().as_ref(), mint.key().as_ref(), beneficiary.key().as_ref()],
        bump,
    )]
    pub handover: Account<'info, Handover>,
    #[account(
        mut,
        constraint = token_account.owner == owner.key(),
        constraint = token_account.mint == mint.key(),
    )]
    pub token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    /// CHECK: beneficiary is checked in the handover account
    pub beneficiary: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

