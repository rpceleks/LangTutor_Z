import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PronunciationData {
  id: string;
  word: string;
  score: number;
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
  const [pronunciations, setPronunciations] = useState<PronunciationData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newWord, setNewWord] = useState("");
  const [score, setScore] = useState(0);
  const [selectedWord, setSelectedWord] = useState<PronunciationData | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
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

  useEffect(() => {
    if (pronunciations.length > 0) {
      const total = pronunciations.length;
      const verified = pronunciations.filter(p => p.isVerified).length;
      const avgScore = pronunciations.reduce((sum, p) => sum + p.publicValue1, 0) / total;
      setStats({ total, verified, avgScore });
    }
  }, [pronunciations]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const pronunciationList: PronunciationData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          pronunciationList.push({
            id: businessId,
            word: businessData.name,
            score: Number(businessData.publicValue1) || 0,
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
      
      setPronunciations(pronunciationList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const recordPronunciation = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setRecording(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting pronunciation score..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const businessId = `pronunciation-${Date.now()}`;
      const randomScore = Math.floor(Math.random() * 100) + 1;
      
      const encryptedResult = await encrypt(contractAddress, address, randomScore);
      
      const tx = await contract.createBusinessData(
        businessId,
        newWord,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        randomScore,
        0,
        "Pronunciation Analysis"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Storing encrypted data..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Pronunciation recorded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowRecordModal(false);
      setNewWord("");
      setScore(0);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Recording failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setRecording(false); 
    }
  };

  const decryptScore = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Score already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
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
      
      setTransactionStatus({ visible: true, status: "success", message: "Score decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Score already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ status: "error", message: "Decryption failed", visible: true });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System is available" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPronunciations = pronunciations.filter(p => 
    p.word.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
            <h2>Connect Wallet to Start Learning</h2>
            <p>Connect your wallet to access encrypted pronunciation analysis with FHE protection.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading pronunciation data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Language Tutor 🔐</h1>
          <span>FHE-Protected Pronunciation Analysis</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check System
          </button>
          <button 
            onClick={() => setShowRecordModal(true)} 
            className="record-btn"
          >
            Record Pronunciation
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Recordings</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified Scores</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-panel">
            <h3>Average Score</h3>
            <div className="stat-value">{stats.avgScore.toFixed(1)}</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search words..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="pronunciations-list">
          {filteredPronunciations.length === 0 ? (
            <div className="empty-state">
              <p>No pronunciation records found</p>
              <button onClick={() => setShowRecordModal(true)} className="record-btn">
                Record First Word
              </button>
            </div>
          ) : (
            filteredPronunciations.map((pronunciation, index) => (
              <div 
                className={`pronunciation-item ${selectedWord?.id === pronunciation.id ? "selected" : ""}`}
                key={index}
                onClick={() => setSelectedWord(pronunciation)}
              >
                <div className="word-bubble">
                  <span className="word">{pronunciation.word}</span>
                  <span className="score">{pronunciation.publicValue1}/100</span>
                </div>
                <div className="word-meta">
                  <span>{new Date(pronunciation.timestamp * 1000).toLocaleDateString()}</span>
                  <span className={`status ${pronunciation.isVerified ? "verified" : "pending"}`}>
                    {pronunciation.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showRecordModal && (
        <RecordModal 
          onSubmit={recordPronunciation} 
          onClose={() => setShowRecordModal(false)} 
          recording={recording} 
          word={newWord}
          setWord={setNewWord}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedWord && (
        <DetailModal 
          word={selectedWord} 
          onClose={() => {
            setSelectedWord(null);
            setDecryptedScore(null);
          }} 
          decryptedScore={decryptedScore}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptScore={() => decryptScore(selectedWord.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>Private Language Tutor - FHE Protected Pronunciation Analysis</p>
      </footer>
    </div>
  );
};

const RecordModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  recording: boolean;
  word: string;
  setWord: (word: string) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, recording, word, setWord, isEncrypting }) => {
  return (
    <div className="modal-overlay">
      <div className="record-modal">
        <div className="modal-header">
          <h2>Record Pronunciation</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Your pronunciation score will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Word to Practice *</label>
            <input 
              type="text" 
              value={word} 
              onChange={(e) => setWord(e.target.value)} 
              placeholder="Enter word..." 
            />
          </div>
          
          <div className="recording-preview">
            <div className="sound-wave">
              <div className="wave-bar"></div>
              <div className="wave-bar"></div>
              <div className="wave-bar"></div>
              <div className="wave-bar"></div>
              <div className="wave-bar"></div>
            </div>
            <p>Click record to start pronunciation analysis</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={recording || isEncrypting || !word}
            className="record-submit-btn"
          >
            {recording || isEncrypting ? "Encrypting..." : "Record & Analyze"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  word: PronunciationData;
  onClose: () => void;
  decryptedScore: number | null;
  isDecrypting: boolean;
  decryptScore: () => Promise<number | null>;
}> = ({ word, onClose, decryptedScore, isDecrypting, decryptScore }) => {
  const handleDecrypt = async () => {
    if (decryptedScore !== null) return;
    await decryptScore();
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Pronunciation Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="word-display">
            <span className="main-word">{word.word}</span>
            <span className="public-score">Score: {word.publicValue1}/100</span>
          </div>
          
          <div className="encrypted-section">
            <h3>Encrypted Analysis</h3>
            <div className="data-row">
              <span>Encrypted Score:</span>
              <span className="encrypted-status">
                {word.isVerified ? 
                  `${word.decryptedValue} (Verified)` : 
                  decryptedScore !== null ? 
                  `${decryptedScore} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </span>
              <button 
                className={`decrypt-btn ${word.isVerified || decryptedScore !== null ? 'decrypted' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 word.isVerified ? "Verified" : 
                 decryptedScore !== null ? "Decrypted" : 
                 "Decrypt Score"}
              </button>
            </div>
          </div>
          
          <div className="pronunciation-tips">
            <h3>Improvement Tips</h3>
            <ul>
              <li>Practice vowel sounds slowly</li>
              <li>Record and compare with native speakers</li>
              <li>Focus on intonation patterns</li>
            </ul>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;