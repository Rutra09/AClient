#ifndef ENGINE_HTTP_H
#define ENGINE_HTTP_H

#include "kernel.h"

#include <memory>

enum class EHttpState
{
	ERROR = -1,
	QUEUED,
	RUNNING,
	DONE,
	ABORTED,
};

enum class HTTPLOG
{
	NONE,
	FAILURE,
	ALL,
};

enum class IPRESOLVE
{
	WHATEVER,
	V4,
	V6,
};

class IHttpRequest
{
public:
	virtual ~IHttpRequest() {}
	virtual EHttpState State() const = 0;
	virtual void HeaderString(const char *pKey, const char *pValue) = 0;
};

class IHttp : public IInterface
{
	MACRO_INTERFACE("http")

public:
	virtual void Run(std::shared_ptr<IHttpRequest> pRequest) = 0;
};

#endif
