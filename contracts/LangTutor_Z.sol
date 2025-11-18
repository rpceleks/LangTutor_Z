pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LangTutorAdapter is ZamaEthereumConfig {
    
    struct TutorSession {
        string studentId;                    
        euint32 encryptedAudio;        
        uint256 lessonId;          
        uint256 errorCount;          
        string feedback;            
        address tutor;               
        uint256 timestamp;             
        uint32 decryptedScore; 
        bool isEvaluated; 
    }
    

    mapping(string => TutorSession) public tutorSessions;
    
    string[] public sessionIds;
    
    event TutorSessionCreated(string indexed sessionId, address indexed tutor);
    event EvaluationCompleted(string indexed sessionId, uint32 decryptedScore);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createTutorSession(
        string calldata sessionId,
        string calldata studentId,
        externalEuint32 encryptedAudio,
        bytes calldata inputProof,
        uint256 lessonId,
        uint256 errorCount,
        string calldata feedback
    ) external {
        require(bytes(tutorSessions[sessionId].studentId).length == 0, "Session already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedAudio, inputProof)), "Invalid encrypted audio");
        
        tutorSessions[sessionId] = TutorSession({
            studentId: studentId,
            encryptedAudio: FHE.fromExternal(encryptedAudio, inputProof),
            lessonId: lessonId,
            errorCount: errorCount,
            feedback: feedback,
            tutor: msg.sender,
            timestamp: block.timestamp,
            decryptedScore: 0,
            isEvaluated: false
        });
        
        FHE.allowThis(tutorSessions[sessionId].encryptedAudio);
        
        FHE.makePubliclyDecryptable(tutorSessions[sessionId].encryptedAudio);
        
        sessionIds.push(sessionId);
        
        emit TutorSessionCreated(sessionId, msg.sender);
    }
    
    function completeEvaluation(
        string calldata sessionId, 
        bytes memory abiEncodedClearScore,
        bytes memory decryptionProof
    ) external {
        require(bytes(tutorSessions[sessionId].studentId).length > 0, "Session does not exist");
        require(!tutorSessions[sessionId].isEvaluated, "Session already evaluated");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(tutorSessions[sessionId].encryptedAudio);
        
        FHE.checkSignatures(cts, abiEncodedClearScore, decryptionProof);
        
        uint32 decodedScore = abi.decode(abiEncodedClearScore, (uint32));
        
        tutorSessions[sessionId].decryptedScore = decodedScore;
        tutorSessions[sessionId].isEvaluated = true;
        
        emit EvaluationCompleted(sessionId, decodedScore);
    }
    
    function getEncryptedAudio(string calldata sessionId) external view returns (euint32) {
        require(bytes(tutorSessions[sessionId].studentId).length > 0, "Session does not exist");
        return tutorSessions[sessionId].encryptedAudio;
    }
    
    function getTutorSession(string calldata sessionId) external view returns (
        string memory studentId,
        uint256 lessonId,
        uint256 errorCount,
        string memory feedback,
        address tutor,
        uint256 timestamp,
        bool isEvaluated,
        uint32 decryptedScore
    ) {
        require(bytes(tutorSessions[sessionId].studentId).length > 0, "Session does not exist");
        TutorSession storage session = tutorSessions[sessionId];
        
        return (
            session.studentId,
            session.lessonId,
            session.errorCount,
            session.feedback,
            session.tutor,
            session.timestamp,
            session.isEvaluated,
            session.decryptedScore
        );
    }
    
    function getAllSessionIds() external view returns (string[] memory) {
        return sessionIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


