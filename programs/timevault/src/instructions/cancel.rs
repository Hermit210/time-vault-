use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

use crate::state::Handover;

pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
    // Revoke delegation from the token account
    token::revoke(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Revoke {
                source: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
    )?;

    // Zero data before closing
    ctx.accounts.handover.set_inner(Handover::default());

    // Close handover account and return rent to owner
    ctx.accounts.handover.close(ctx.accounts.owner.to_account_info())?;

    Ok(())
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"handover", owner.key().as_ref(), mint.key().as_ref(), beneficiary.key().as_ref()],
        bump = handover.bump,
        has_one = owner,
        has_one = mint,
    )]
    pub handover: Account<'info, Handover>,
    #[account(
        mut,
        constraint = token_account.owner == owner.key(),
        constraint = token_account.mint == mint.key(),
    )]
    pub token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    /// CHECK: beneficiary is checked in the handover account seeds
    pub beneficiary: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

