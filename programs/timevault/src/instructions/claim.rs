use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

use crate::state::Handover;
use crate::error::ErrorCode;
use crate::pubkeys;

pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let deadline = ctx.accounts.handover.last_checkin.checked_add(ctx.accounts.handover.timeout)
        .ok_or(ErrorCode::ArithmeticError)?;
    require!(now > deadline, ErrorCode::StillActive);

    let amount = ctx.accounts.token_account.amount;
    let seeds = [
        b"handover".as_ref(),
        ctx.accounts.handover.owner.as_ref(),
        ctx.accounts.handover.mint.as_ref(),
        ctx.accounts.handover.beneficiary.as_ref(),
        &[ctx.accounts.handover.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Calculate 0.5% fee
    let fee_amount = amount.checked_mul(5).ok_or(ErrorCode::ArithmeticError)?
        .checked_div(1000).ok_or(ErrorCode::ArithmeticError)?;
    let beneficiary_amount = amount.checked_sub(fee_amount).ok_or(ErrorCode::ArithmeticError)?;

    // Transfer fee to fee account
    if fee_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.token_account.to_account_info(),
                    to: ctx.accounts.fee_token_account.to_account_info(),
                    authority: ctx.accounts.handover.to_account_info(),
                },
                signer_seeds,
            ),
            fee_amount,
        )?;
    }

    // Transfer remaining tokens to beneficiary
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.token_account.to_account_info(),
                to: ctx.accounts.beneficiary_token_account.to_account_info(),
                authority: ctx.accounts.handover.to_account_info(),
            },
            signer_seeds,
        ),
        beneficiary_amount,
    )?;

    // Zero data before closing
    ctx.accounts.handover.set_inner(Handover::default());

    // Close handover account
    ctx.accounts.handover.close(ctx.accounts.beneficiary.to_account_info())?;

    Ok(())
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    /// CHECK: owner is checked in the handover account
    pub owner: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"handover", owner.key().as_ref(), mint.key().as_ref(), beneficiary.key().as_ref()],
        bump = handover.bump,
        has_one = beneficiary,
        has_one = owner,
        has_one = mint,
    )]
    pub handover: Account<'info, Handover>,
    #[account(
        mut,
        address = handover.token_account @ ErrorCode::InvalidTokenAccount
    )]
    pub token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = beneficiary,
        associated_token::mint = mint,
        associated_token::authority = beneficiary,
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = beneficiary,
        associated_token::mint = mint,
        associated_token::authority = fee_authority,
    )]
    pub fee_token_account: Account<'info, TokenAccount>,
    /// CHECK: Fee authority is validated against the pubkeys module
    #[account(address = pubkeys::FEE_ACCOUNT)]
    pub fee_authority: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
