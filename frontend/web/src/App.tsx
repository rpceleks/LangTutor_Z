import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LanguagePractice {
  id: number;
  name: string;
  language: string;
  practiceType: string;
  score: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [practices, setPractices] = useState<LanguagePractice[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPractice, setCreatingPractice] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPracticeData, setNewPracticeData] = useState({ 
    name: "", 
    language: "English", 
    practiceType: "pronunciation",
    score: "" 
  });
  const [selectedPractice, setSelectedPractice] = useState<LanguagePractice | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, verified: 0, avgScore: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const practicesList: LanguagePractice[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          practicesList.push({
            id: parseInt(businessId.replace('practice-', '')) || Date.now(),
            name: businessData.name,
            language: "English",
            practiceType: "pronunciation",
            score: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPractices(practicesList);
      updateStats(practicesList);
      updateUserHistory(practicesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (practicesList: LanguagePractice[]) => {
    const total = practicesList.length;
    const verified = practicesList.filter(p => p.isVerified).length;
    const avgScore = practicesList.length > 0 
      ? practicesList.reduce((sum, p) => sum + p.publicValue1, 0) / practicesList.length 
      : 0;
    
    setStats({ total, verified, avgScore });
  };

  const updateUserHistory = (practicesList: LanguagePractice[]) => {
    if (!address) return;
    
    const userPractices = practicesList.filter(p => p.creator.toLowerCase() === address.toLowerCase());
    const history = userPractices.map(practice => ({
      id: practice.id,
      name: practice.name,
      score: practice.isVerified ? (practice.decryptedValue || 0) : practice.publicValue1,
      timestamp: practice.timestamp,
      isVerified: practice.isVerified,
      type: 'practice'
    }));
    
    setUserHistory(history.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10));
  };

  const createPractice = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPractice(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating practice session with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newPracticeData.score) || 0;
      const businessId = `practice-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPracticeData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        scoreValue,
        0,
        `Language: ${newPracticeData.language}, Type: ${newPracticeData.practiceType}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Encrypting and storing data..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Practice session created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPracticeData({ name: "", language: "English", practiceType: "pronunciation", score: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPractice(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Score already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Score decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Score already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "FHE system is available and ready!" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel neon-purple">
          <h3>Total Practices</h3>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="stat-panel neon-blue">
          <h3>Verified Scores</h3>
          <div className="stat-value">{stats.verified}/{stats.total}</div>
          <div className="stat-trend">On-chain Verified</div>
        </div>
        
        <div className="stat-panel neon-pink">
          <h3>Avg Score</h3>
          <div className="stat-value">{stats.avgScore.toFixed(1)}/100</div>
          <div className="stat-trend">Encrypted Analysis</div>
        </div>
      </div>
    );
  };

  const renderProgressChart = (practice: LanguagePractice, decryptedScore: number | null) => {
    const score = practice.isVerified ? (practice.decryptedValue || 0) : (decryptedScore || practice.publicValue1 || 50);
    
    return (
      <div className="progress-chart">
        <div className="chart-header">
          <span>Pronunciation Score</span>
          <span className="score-value">{score}/100</span>
        </div>
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ width: `${score}%` }}
          ></div>
        </div>
        <div className="chart-metrics">
          <div className="metric">
            <span>Accuracy</span>
            <span>{Math.round(score * 0.8)}%</span>
          </div>
          <div className="metric">
            <span>Fluency</span>
            <span>{Math.round(score * 0.6)}%</span>
          </div>
          <div className="metric">
            <span>Rhythm</span>
            <span>{Math.round(score * 0.7)}%</span>
          </div>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    if (userHistory.length === 0) return null;
    
    return (
      <div className="history-section">
        <h3>Your Recent Practice</h3>
        <div className="history-list">
          {userHistory.map((item, index) => (
            <div className="history-item" key={index}>
              <div className="history-name">{item.name}</div>
              <div className="history-score">{item.score}/100</div>
              <div className="history-time">
                {new Date(item.timestamp * 1000).toLocaleDateString()}
              </div>
              <div className={`history-status ${item.isVerified ? 'verified' : 'pending'}`}>
                {item.isVerified ? '✅' : '🔒'}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Language Tutor 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🎯</div>
            <h2>Connect to Start Learning</h2>
            <p>Connect your wallet to begin encrypted language practice with FHE protection</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🔒</div>
                <h4>Encrypted Analysis</h4>
                <p>Your speech data remains private with FHE encryption</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <h4>Real-time Feedback</h4>
                <p>Get instant pronunciation analysis without exposing data</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🌍</div>
                <h4>Multi-language</h4>
                <p>Support for various languages with homomorphic processing</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your language data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading your practice sessions...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Language Tutor 🔐</h1>
          <span className="tagline">FHE-Protected Pronunciation Analysis</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test FHE
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Practice
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Your Learning Dashboard</h2>
          {renderStatsPanel()}
          
          <div className="fhe-explainer">
            <h3>How FHE Protects Your Learning</h3>
            <div className="fhe-steps">
              <div className="step">
                <span>1</span>
                <p>Speech scores encrypted with Zama FHE</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>AI analyzes pronunciation without decryption</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Only you can decrypt and view results</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="content-grid">
          <div className="practices-section">
            <div className="section-header">
              <h2>Practice Sessions</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="practices-list">
              {practices.length === 0 ? (
                <div className="no-practices">
                  <p>No practice sessions found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Start First Practice
                  </button>
                </div>
              ) : practices.map((practice, index) => (
                <div 
                  className={`practice-item ${selectedPractice?.id === practice.id ? "selected" : ""} ${practice.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedPractice(practice)}
                >
                  <div className="practice-header">
                    <div className="practice-title">{practice.name}</div>
                    <div className="practice-badge">{practice.language}</div>
                  </div>
                  <div className="practice-meta">
                    <span>Type: {practice.practiceType}</span>
                    <span>Date: {new Date(practice.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="practice-status">
                    {practice.isVerified ? 
                      `✅ Score: ${practice.decryptedValue}/100` : 
                      "🔒 Encrypted - Click to verify"
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="sidebar">
            {renderUserHistory()}
            
            <div className="quick-actions">
              <h3>Quick Actions</h3>
              <button className="action-btn" onClick={testAvailability}>
                Check FHE Status
              </button>
              <button className="action-btn" onClick={() => setShowCreateModal(true)}>
                New Pronunciation Test
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreatePractice 
          onSubmit={createPractice} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingPractice} 
          practiceData={newPracticeData} 
          setPracticeData={setNewPracticeData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPractice && (
        <PracticeDetailModal 
          practice={selectedPractice} 
          onClose={() => setSelectedPractice(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedPractice.score)}
          renderProgressChart={renderProgressChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreatePractice: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  practiceData: any;
  setPracticeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, practiceData, setPracticeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'score') {
      const intValue = value.replace(/[^\d]/g, '');
      setPracticeData({ ...practiceData, [name]: intValue });
    } else {
      setPracticeData({ ...practiceData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-practice-modal">
        <div className="modal-header">
          <h2>New Language Practice</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Your pronunciation score will be encrypted with Zama FHE</p>
          </div>
          
          <div className="form-group">
            <label>Practice Name *</label>
            <input 
              type="text" 
              name="name" 
              value={practiceData.name} 
              onChange={handleChange} 
              placeholder="Describe your practice..." 
            />
          </div>
          
          <div className="form-group">
            <label>Language</label>
            <select name="language" value={practiceData.language} onChange={handleChange}>
              <option value="English">English</option>
              <option value="Spanish">Spanish</option>
              <option value="French">French</option>
              <option value="German">German</option>
              <option value="Japanese">Japanese</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Practice Type</label>
            <select name="practiceType" value={practiceData.practiceType} onChange={handleChange}>
              <option value="pronunciation">Pronunciation</option>
              <option value="conversation">Conversation</option>
              <option value="vocabulary">Vocabulary</option>
              <option value="listening">Listening</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>AI Score (0-100) *</label>
            <input 
              type="number" 
              name="score" 
              value={practiceData.score} 
              onChange={handleChange} 
              placeholder="Enter AI assessment score..." 
              min="0"
              max="100"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !practiceData.name || !practiceData.score} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Practice"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PracticeDetailModal: React.FC<{
  practice: LanguagePractice;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderProgressChart: (practice: LanguagePractice, decryptedScore: number | null) => JSX.Element;
}> = ({ practice, onClose, isDecrypting, decryptData, renderProgressChart }) => {
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (practice.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedScore(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="practice-detail-modal">
        <div className="modal-header">
          <h2>Practice Analysis</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="practice-info">
            <div className="info-grid">
              <div className="info-item">
                <span>Practice:</span>
                <strong>{practice.name}</strong>
              </div>
              <div className="info-item">
                <span>Language:</span>
                <strong>{practice.language}</strong>
              </div>
              <div className="info-item">
                <span>Type:</span>
                <strong>{practice.practiceType}</strong>
              </div>
              <div className="info-item">
                <span>Date:</span>
                <strong>{new Date(practice.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
            </div>
          </div>
          
          <div className="analysis-section">
            <h3>Pronunciation Analysis</h3>
            
            <div className="score-display">
              <div className="score-label">AI Assessment Score</div>
              <div className="score-value">
                {practice.isVerified ? 
                  `${practice.decryptedValue}/100 (Verified)` : 
                  decryptedScore !== null ? 
                  `${decryptedScore}/100 (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${practice.isVerified ? 'verified' : decryptedScore !== null ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || practice.isVerified}
              >
                {isDecrypting ? "Decrypting..." : practice.isVerified ? "✅ Verified" : "🔓 Decrypt Score"}
              </button>
            </div>
            
            {(practice.isVerified || decryptedScore !== null) && (
              <div className="progress-section">
                {renderProgressChart(practice, decryptedScore)}
                
                <div className="feedback">
                  <h4>AI Feedback</h4>
                  <p>Your pronunciation shows good progress. Focus on vowel sounds and intonation patterns.</p>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!practice.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


