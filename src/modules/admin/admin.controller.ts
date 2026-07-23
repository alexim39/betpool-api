import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { adminService } from './admin.service';
import { aiSettlementService } from '../ai';
import { LoanModel } from './loan.model';

export class AdminController {
  async getDashboard(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await adminService.getDashboard();
      res.json({ success: true, data });
    } catch (error) {
      console.error('Admin dashboard error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
    }
  }

  async listPods(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, status, search } = req.query;
      const result = await adminService.listPods({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        status: status as string,
        search: search as string
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin list pods error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch pods' });
    }
  }

  async getPod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const pod = await adminService.getPod(id);
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: pod });
    } catch (error) {
      console.error('Admin get pod error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch pod' });
    }
  }

  async createPod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const pod = await adminService.createPod(req.body, userId);
      res.status(201).json({ success: true, data: pod });
    } catch (error: any) {
      console.error('Admin create pod error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to create pod' });
    }
  }

  async updatePod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.userId;
      const pod = await adminService.updatePod(id, req.body, userId);
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: pod });
    } catch (error: any) {
      console.error('Admin update pod error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to update pod' });
    }
  }

  async publishPod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const pod = await adminService.publishPod(id);
      if (!pod) {
        res.status(404).json({ success: false, message: 'Pod not found' });
        return;
      }
      res.json({ success: true, data: pod });
    } catch (error) {
      console.error('Admin publish pod error:', error);
      res.status(500).json({ success: false, message: 'Failed to publish pod' });
    }
  }

  async activatePod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const pod = await adminService.activatePod(id);
      res.json({ success: true, data: pod });
    } catch (error: any) {
      console.error('Admin activate pod error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to activate pod' });
    }
  }

  async settlePod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { result, notes, homeScore, awayScore } = req.body;
      const userId = req.user!.userId;

      if (!['win', 'loss', 'void'].includes(result)) {
        res.status(400).json({ success: false, message: 'Invalid result. Must be: win, loss, or void' });
        return;
      }

      // Fetch scores from sports API if not provided in the request
      let finalHomeScore = homeScore;
      let finalAwayScore = awayScore;
      if (finalHomeScore === undefined || finalAwayScore === undefined) {
        try {
          const check = await aiSettlementService.checkPod(id);
          if (check.homeScore != null && check.awayScore != null) {
            finalHomeScore = check.homeScore;
            finalAwayScore = check.awayScore;
          }
        } catch { /* scores unavailable — settle without them */ }
      }

      const pod = await adminService.settlePod(id, result, userId, notes, finalHomeScore, finalAwayScore);
      res.json({ success: true, data: pod });
    } catch (error: any) {
      console.error('Admin settle pod error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to settle pod' });
    }
  }

  async cancelPod(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.userId;
      const pod = await adminService.cancelPod(id, userId);
      res.json({ success: true, data: pod });
    } catch (error: any) {
      console.error('Admin cancel pod error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to cancel pod' });
    }
  }

  async listUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, search } = req.query;
      const result = await adminService.listUsers({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        search: search as string
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin list users error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
  }

  async getUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const result = await adminService.getUser(id);
      if (!result.user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin get user error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch user' });
    }
  }

  async toggleUserStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const user = await adminService.toggleUserStatus(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      const statusText = user.isSuspended ? 'suspended' : 'active';
      res.json({ success: true, data: user, message: `User ${statusText}` });
    } catch (error) {
      console.error('Admin toggle user status error:', error);
      res.status(500).json({ success: false, message: 'Failed to toggle user status' });
    }
  }

  async verifyUserKYC(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const user = await adminService.verifyUserKYC(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      const statusText = user.kycVerified ? 'verified' : 'unverified';
      res.json({ success: true, data: user, message: `KYC ${statusText}` });
    } catch (error) {
      console.error('Admin verify KYC error:', error);
      res.status(500).json({ success: false, message: 'Failed to verify KYC' });
    }
  }

  async listStakes(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, status, userId, podId } = req.query;
      const result = await adminService.listStakes({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        status: status as string,
        userId: userId as string,
        podId: podId as string
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin list stakes error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch stakes' });
    }
  }

  async getStake(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const stake = await adminService.getStake(id);
      if (!stake) {
        res.status(404).json({ success: false, message: 'Stake not found' });
        return;
      }
      res.json({ success: true, data: stake });
    } catch (error) {
      console.error('Admin get stake error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch stake' });
    }
  }

  async settleStake(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { result, notes } = req.body;
      const userId = req.user!.userId;

      if (!['win', 'loss', 'void'].includes(result)) {
        res.status(400).json({ success: false, message: 'Invalid result. Must be: win, loss, or void' });
        return;
      }

      const stake = await adminService.settleStake(id, result, userId, notes);
      res.json({ success: true, data: stake });
    } catch (error: any) {
      console.error('Admin settle stake error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to settle stake' });
    }
  }

  async voidStake(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.userId;
      const stake = await adminService.voidStake(id, userId);
      if (!stake) {
        res.status(404).json({ success: false, message: 'Stake not found' });
        return;
      }
      res.json({ success: true, data: stake });
    } catch (error: any) {
      console.error('Admin void stake error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to void stake' });
    }
  }

  async listTransactions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, type, status, userId } = req.query;
      const result = await adminService.listTransactions({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        type: type as string,
        status: status as string,
        userId: userId as string
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin list transactions error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
    }
  }

  async rejectUserKYC(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const user = await adminService.rejectUserKYC(id, notes || 'KYC documents rejected');
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      res.json({ success: true, data: user, message: 'KYC rejected' });
    } catch (error: any) {
      console.error('Admin reject KYC error:', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to reject KYC' });
    }
  }

  async getWithdrawal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const transaction = await adminService.getWithdrawal(id);
      if (!transaction) {
        res.status(404).json({ success: false, message: 'Withdrawal not found' });
        return;
      }
      res.json({ success: true, data: transaction });
    } catch (error) {
      console.error('Admin get withdrawal error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch withdrawal' });
    }
  }

  async listWithdrawals(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, status } = req.query;
      const result = await adminService.listWithdrawals({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        status: status as string
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin list withdrawals error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch withdrawals' });
    }
  }

  async approveWithdrawal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const adminId = req.user!.userId;
      const result = await adminService.approveWithdrawal(id, adminId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Admin approve withdrawal error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to approve withdrawal' });
    }
  }

  async rejectWithdrawal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.user!.userId;
      const result = await adminService.rejectWithdrawal(id, reason || 'Rejected by admin', adminId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Admin reject withdrawal error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to reject withdrawal' });
    }
  }

  async listLoans(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, status, userId } = req.query;
      const result = await adminService.listLoans({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        status: status as string,
        userId: userId as string
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin list loans error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch loans' });
    }
  }

  async getLoan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const loan = await adminService.getLoan(id);
      if (!loan) {
        res.status(404).json({ success: false, message: 'Loan not found' });
        return;
      }
      res.json({ success: true, data: loan });
    } catch (error) {
      console.error('Admin get loan error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch loan' });
    }
  }

  async createLoan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { userId, amount, purpose, interestRate, dueDate } = req.body;
      if (!userId || !amount || !purpose) {
        res.status(400).json({ success: false, message: 'userId, amount, and purpose required' });
        return;
      }
      if (amount < 100) {
        res.status(400).json({ success: false, message: 'Minimum loan amount is ₦100' });
        return;
      }
      const user = await import('../../models/user.model').then(m => m.UserModel.findById(userId));
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      const loan = await LoanModel.create({
        user: userId,
        amount,
        purpose,
        interestRate: interestRate || 0,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        status: 'pending'
      });
      res.json({ success: true, data: loan });
    } catch (error: any) {
      console.error('Admin create loan error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to create loan' });
    }
  }

  async approveLoan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const adminId = req.user!.userId;
      const result = await adminService.approveLoan(id, adminId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Admin approve loan error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to approve loan' });
    }
  }

  async rejectLoan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const result = await adminService.rejectLoan(id, reason || 'Rejected by admin');
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Admin reject loan error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to reject loan' });
    }
  }

  async repayLoan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const result = await adminService.repayLoan(id);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Admin repay loan error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to repay loan' });
    }
  }

  async toggleExternalBooking(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const adminId = req.user!.userId;
      const pod = await adminService.toggleExternalBooking(id, adminId);
      res.json({ success: true, data: pod });
    } catch (error: any) {
      console.error('Toggle external booking error:', error);
      res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to toggle external booking' });
    }
  }

  async listPodsReadyForBetting(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, search, sport, booked, sortBy, sortOrder, listStatus } = req.query;
      const result = await adminService.listPodsReadyForBetting({
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
        search: search as string,
        sport: sport as string,
        booked: booked as string,
        sortBy: sortBy as string,
        sortOrder: sortOrder as string,
        listStatus: listStatus as string,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin list pods ready for betting error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch pods ready for betting' });
    }
  }

  async manualAdjustment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { userId, amount, type, reason } = req.body;
      const adminId = req.user!.userId;

      if (!userId || !amount || !type || !reason) {
        res.status(400).json({ success: false, message: 'userId, amount, type, and reason required' });
        return;
      }

      if (!['credit', 'debit'].includes(type)) {
        res.status(400).json({ success: false, message: 'Type must be credit or debit' });
        return;
      }

      if (amount < 1) {
        res.status(400).json({ success: false, message: 'Amount must be positive' });
        return;
      }

      const result = await adminService.manualAdjustment(userId, amount, type, reason, adminId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Admin manual adjustment error:', error);
      res.status(400).json({ success: false, message: error.message || 'Failed to adjust wallet' });
    }
  }
  async getReserveConsumption(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await adminService.getReserveConsumption();
      res.json({ success: true, data });
    } catch (error) {
      console.error('Reserve consumption error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch reserve consumption' });
    }
  }
}

export const adminController = new AdminController();

